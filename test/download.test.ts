import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { processDownload } from "../src/download";
import type { DownloadPackageMessage } from "../src/sync";
import { zipFiles } from "./zip";

function message(version: string): DownloadPackageMessage {
  return {
    type: "download-package",
    name: "store/checksum-plugin",
    version,
    composerJson: { name: "store/checksum-plugin", version },
    downloadUrl: "https://upstream.example/plugin.zip",
    token: "store-token",
  };
}

function keys(version: string) {
  return {
    zip: `packages/store/checksum-plugin/${version}.zip`,
    checksums: `packages/store/checksum-plugin/${version}.checksums.json`,
  };
}

async function published(version: string) {
  return env.DB.prepare("SELECT * FROM packages WHERE name = ? AND version = ?")
    .bind("store/checksum-plugin", version)
    .first();
}

const expectedManifest = {
  algorithm: "xxh128",
  files: { "Plugin/file.txt": "06b05ab6733a618578af5f94892f3950" },
};

async function archive() {
  return zipFiles({ "Plugin/file.txt": new TextEncoder().encode("abc") });
}

afterEach(() => vi.restoreAllMocks());

describe("package download checksums", () => {
  it("stores the unchanged ZIP and manifest before publishing", async () => {
    const zip = await archive();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(zip));
    await processDownload(message("1.0.0"), env);
    expect(fetch).toHaveBeenCalledWith("https://upstream.example/plugin.zip", {
      headers: { Authorization: "Bearer store-token" },
      redirect: "manual",
    });
    const stored = await env.PACKAGES_BUCKET.get(keys("1.0.0").zip);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(zip);
    const checksums = await env.PACKAGES_BUCKET.get(keys("1.0.0").checksums);
    expect(checksums!.httpMetadata?.contentType).toBe("application/json");
    expect(await checksums!.json()).toEqual(expectedManifest);
    expect(await published("1.0.0")).not.toBeNull();
  });

  it("generates missing checksums from an existing ZIP without fetching upstream", async () => {
    await env.PACKAGES_BUCKET.put(keys("2.0.0").zip, await archive());
    const fetch = vi.spyOn(globalThis, "fetch");
    await processDownload(message("2.0.0"), env);
    expect(fetch).not.toHaveBeenCalled();
    expect(await (await env.PACKAGES_BUCKET.get(keys("2.0.0").checksums))!.json()).toEqual(
      expectedManifest,
    );
    // A duplicate queue delivery preserves the already-stored manifest.
    const before = await env.PACKAGES_BUCKET.head(keys("2.0.0").checksums);
    await processDownload(message("2.0.0"), env);
    expect((await env.PACKAGES_BUCKET.head(keys("2.0.0").checksums))!.version).toBe(
      before!.version,
    );
  });

  it("does not publish invalid ZIPs or write a manifest", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not a ZIP"));
    await expect(processDownload(message("3.0.0"), env)).rejects.toThrow();
    expect(await published("3.0.0")).toBeNull();
    expect(await env.PACKAGES_BUCKET.head(keys("3.0.0").checksums)).toBeNull();
  });

  it("recovers from a failed manifest upload on retry", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(await archive()));
    const originalPut = env.PACKAGES_BUCKET.put.bind(env.PACKAGES_BUCKET);
    const put = vi
      .spyOn(env.PACKAGES_BUCKET, "put")
      .mockImplementation((...args: Parameters<R2Bucket["put"]>) => {
        if (args[0] === keys("4.0.0").checksums) throw new Error("R2 unavailable");
        return originalPut(...args);
      });
    await expect(processDownload(message("4.0.0"), env)).rejects.toThrow("R2 unavailable");
    expect(await published("4.0.0")).toBeNull();
    expect(await env.PACKAGES_BUCKET.head(keys("4.0.0").zip)).not.toBeNull();
    put.mockRestore();
    await processDownload(message("4.0.0"), env);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await published("4.0.0")).not.toBeNull();
    expect(await (await env.PACKAGES_BUCKET.get(keys("4.0.0").checksums))!.json()).toEqual(
      expectedManifest,
    );
  });

  it("still ignores missing licenses without storing objects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('"Plugin license not found."', { status: 403 }),
    );
    await processDownload(message("5.0.0"), env);
    expect(await env.PACKAGES_BUCKET.head(keys("5.0.0").zip)).toBeNull();
    expect(await env.PACKAGES_BUCKET.head(keys("5.0.0").checksums)).toBeNull();
    expect(await published("5.0.0")).toBeNull();
  });
});
