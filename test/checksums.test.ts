import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { zipFiles } from "./zip";
import { createChecksumManifest } from "../src/checksums";
import { createXXH128 } from "../src/xxh128";

async function manifest(zip: Uint8Array) {
  const object = await env.PACKAGES_BUCKET.put("checksum-test.zip", zip);
  return createChecksumManifest(env.PACKAGES_BUCKET, object);
}

// Canonical XXH3-128 vectors, also compatible with PHP hash('xxh128', ...).
describe("XXH128", () => {
  it.each([
    ["", "99aa06d3014798d86001c324468d497f"],
    ["abc", "06b05ab6733a618578af5f94892f3950"],
  ])("hashes %j", (input, expected) => {
    const hash = createXXH128();
    hash.init();
    hash.update(new TextEncoder().encode(input));
    expect(hash.digest()).toBe(expected);
  });

  it("supports chunking, large inputs, reset, and independent instances", () => {
    const data = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
    const whole = createXXH128();
    const chunked = createXXH128();
    whole.init();
    chunked.init();
    whole.update(data);
    for (let i = 0; i < data.length; i += 123) chunked.update(data.subarray(i, i + 123));
    const expected = "54182c58bbb1337c42c23aeead96750d"; // hash-wasm reference vector
    expect(chunked.digest()).toBe(expected);
    expect(whole.digest()).toBe(expected);
    chunked.init();
    expect(chunked.digest()).toBe("99aa06d3014798d86001c324468d497f");
  });
});

describe("ZIP checksum manifests", () => {
  it.each([0, 6] as const)("hashes raw contents with compression level %i", async (level) => {
    const result = await manifest(
      await zipFiles(
        {
          "Plugin/": new Uint8Array(),
          "Plugin/empty.txt": new Uint8Array(),
          "Plugin/src/é.php": new TextEncoder().encode("abc"),
        },
        level,
      ),
    );
    expect(result).toEqual({
      algorithm: "xxh128",
      files: {
        "Plugin/empty.txt": "99aa06d3014798d86001c324468d497f",
        "Plugin/src/é.php": "06b05ab6733a618578af5f94892f3950",
      },
    });
  });

  it("includes binary files and prototype-like filenames", async () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    const hash = createXXH128();
    hash.init();
    hash.update(bytes);
    const result = await manifest(await zipFiles(Object.fromEntries([["__proto__", bytes]])));
    expect(Object.keys(result.files)).toEqual(["__proto__"]);
    expect(result.files["__proto__"]).toBe(hash.digest());
  });

  it("accepts an empty ZIP", async () => {
    expect(await manifest(await zipFiles({}))).toEqual({ algorithm: "xxh128", files: {} });
  });

  it("rejects invalid and truncated archives", async () => {
    await expect(manifest(new TextEncoder().encode("not a zip"))).rejects.toThrow();
    const zip = await zipFiles({ "file.txt": new Uint8Array([1, 2, 3]) });
    await expect(manifest(zip.subarray(0, zip.length - 20))).rejects.toThrow();
  });

  it.each(["../file.txt", "/x/file.txt", "C:/file.txt", "ok\\file.txt"])(
    "rejects unsafe path %j",
    async (path) => {
      const zip = await zipFiles({ "ok/file.txt": new Uint8Array([1]) }, 0);
      const original = new TextEncoder().encode("ok/file.txt");
      const replacement = new TextEncoder().encode(path);
      // Patch both local and central headers; ZIP writers sanitize unsafe paths.
      expect(replacement.length).toBe(original.length);
      for (let i = 0; i <= zip.length - original.length; i++) {
        if (original.every((byte, j) => zip[i + j] === byte)) zip.set(replacement, i);
      }
      await expect(manifest(zip)).rejects.toThrow();
    },
  );

  it("rejects duplicate file paths", async () => {
    const zip = await zipFiles({ "a.txt": new Uint8Array([1]), "b.txt": new Uint8Array([2]) });
    const name = new TextEncoder().encode("b.txt");
    for (let i = 0; i <= zip.length - name.length; i++) {
      if (name.every((byte, j) => zip[i + j] === byte)) zip[i] = 97; // a.txt
    }
    await expect(manifest(zip)).rejects.toThrow();
  });

  it("rejects excessive declared uncompressed sizes before extraction", async () => {
    const zip = await zipFiles({ "a.txt": new Uint8Array([1]) });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 513 * 1024 * 1024, true);
        break;
      }
    }
    await expect(manifest(zip)).rejects.toThrow("uncompressed checksum generation limit");
  });

  it("rejects corrupted file contents", async () => {
    const zip = await zipFiles({ "file.txt": new Uint8Array([1, 2, 3]) }, 0);
    const header = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const offset = 30 + header.getUint16(26, true) + header.getUint16(28, true);
    zip[offset] ^= 0xff;
    await expect(manifest(zip)).rejects.toThrow();
  });
});
