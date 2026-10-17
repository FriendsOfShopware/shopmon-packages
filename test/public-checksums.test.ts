import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import worker from "../src/index";

afterEach(() => vi.restoreAllMocks());

const manifest = {
  algorithm: "xxh128",
  files: { "Plugin/file.txt": "06b05ab6733a618578af5f94892f3950" },
};
const url = "http://localhost/api/public/checksums/store/public-checksum-plugin/1.0.0";
const key = "packages/store/public-checksum-plugin/1.0.0.checksums.json";

describe("public checksum manifests", () => {
  beforeAll(async () => {
    // No D1 package or access token is needed to read an existing manifest.
    await env.PACKAGES_BUCKET.put(key, JSON.stringify(manifest));
  });

  it("serves R2 manifests publicly with immutable cache headers", async () => {
    const response = await SELF.fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("ETag")).toBe((await env.PACKAGES_BUCKET.head(key))!.httpEtag);
    expect(response.headers.get("Vary")).toBeNull();
    expect(await response.json()).toEqual(manifest);
  });

  it("is independent of the caller's authorization header", async () => {
    const response = await SELF.fetch(url, { headers: { Authorization: "Bearer invalid-token" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await response.json()).toEqual(manifest);
  });

  it("does not cache missing manifests and serves them once created", async () => {
    const missingUrl = "http://localhost/api/public/checksums/store/late-checksum/2.0.0";
    const missing = await SELF.fetch(missingUrl);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    await env.PACKAGES_BUCKET.put(
      "packages/store/late-checksum/2.0.0.checksums.json",
      JSON.stringify(manifest),
    );
    const available = await SELF.fetch(missingUrl);
    expect(available.status).toBe(200);
    expect(await available.json()).toEqual(manifest);
  });

  it("does not serve ZIP contents in place of missing manifests", async () => {
    await env.PACKAGES_BUCKET.put("packages/store/zip-only/1.0.0.zip", "private ZIP");
    const response = await SELF.fetch("http://localhost/api/public/checksums/store/zip-only/1.0.0");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects encoded path separators", async () => {
    const response = await SELF.fetch(
      "http://localhost/api/public/checksums/store%2Fother/public-checksum-plugin/1.0.0",
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not cache R2 failures", async () => {
    vi.spyOn(env.PACKAGES_BUCKET, "get").mockRejectedValue(new Error("R2 unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await worker.fetch(new Request(url), env, createExecutionContext());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves backfill and ZIP downloads protected", async () => {
    const backfill = await SELF.fetch("http://localhost/api/checksums/backfill", {
      method: "POST",
    });
    expect(backfill.status).toBe(401);
    const download = await SELF.fetch(
      "http://localhost/download/store/public-checksum-plugin/1.0.0",
    );
    expect(download.status).toBe(401);
  });
});
