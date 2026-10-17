import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import worker from "../src/index";
import { processChecksumBackfill, processGenerateChecksums } from "../src/checksum-backfill";
import type { QueueMessage } from "../src/sync";
import { zipFiles } from "./zip";

afterEach(() => vi.restoreAllMocks());

async function consume(body: QueueMessage) {
  const ctx = createExecutionContext();
  const batch = createMessageBatch<QueueMessage>("package-downloads", [
    {
      id: "backfill-test",
      timestamp: new Date(),
      attempts: 1,
      body,
    },
  ]);
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

async function request(token?: string) {
  return worker.fetch(
    new Request("http://localhost/api/checksums/backfill", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    env,
    createExecutionContext(),
  );
}

async function seedZip(version: string) {
  const key = `packages/store/backfill/${version}.zip`;
  const zip = await zipFiles({ "Plugin/file.txt": new TextEncoder().encode("abc") });
  const object = await env.PACKAGES_BUCKET.put(key, zip);
  return { key, object, checksumKey: key.replace(/\.zip$/, ".checksums.json") };
}

describe("checksum backfill API", () => {
  it.each([undefined, "invalid-token"])("requires admin authentication (%s)", async (token) => {
    const send = vi.spyOn(env.DOWNLOAD_QUEUE, "send").mockResolvedValue();
    expect((await request(token)).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("enqueues the first page and returns 202 without scanning R2 inline", async () => {
    const send = vi.spyOn(env.DOWNLOAD_QUEUE, "send").mockResolvedValue();
    const list = vi.spyOn(env.PACKAGES_BUCKET, "list");
    const response = await request("test-api-token");
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ message: "Checksum backfill enqueued" });
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "backfill-checksums" });
    expect(list).not.toHaveBeenCalled();
  });

  it("does not report success if the queue is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(env.DOWNLOAD_QUEUE, "send").mockRejectedValue(new Error("Queue unavailable"));
    expect((await request("test-api-token")).status).toBe(500);
  });
});

describe("checksum backfill pagination", () => {
  it("enqueues at most 100 ZIP jobs per page and continues using the R2 cursor", async () => {
    const { object } = await seedZip("pagination");
    const objects = Array.from({ length: 100 }, (_, i) => ({
      ...object,
      key: `packages/store/backfill/${i}.zip`,
    }));
    const list = vi
      .spyOn(env.PACKAGES_BUCKET, "list")
      .mockResolvedValueOnce({
        objects,
        truncated: true,
        cursor: "next-page",
        delimitedPrefixes: [],
      })
      .mockResolvedValueOnce({ objects: [object], truncated: false, delimitedPrefixes: [] });
    const sendBatch = vi.spyOn(env.DOWNLOAD_QUEUE, "sendBatch").mockResolvedValue();
    const send = vi.spyOn(env.DOWNLOAD_QUEUE, "send").mockResolvedValue();

    // Exercise the queue handler dispatch, not just the scanning function.
    const result = await consume({ type: "backfill-checksums" });
    expect(result.explicitAcks).toEqual(["backfill-test"]);
    expect(sendBatch.mock.calls[0][0]).toHaveLength(100);
    expect(sendBatch.mock.calls[0][0]).toEqual(
      objects.map(({ key }) => ({ body: { type: "generate-checksums", key } })),
    );
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "backfill-checksums",
      cursor: "next-page",
    });

    await processChecksumBackfill({ type: "backfill-checksums", cursor: "next-page" }, env);
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: "packages/",
      limit: 100,
      cursor: "next-page",
    });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("continues through a short page containing only non-ZIP objects", async () => {
    const { object, checksumKey } = await seedZip("non-zip");
    vi.spyOn(env.PACKAGES_BUCKET, "list").mockResolvedValue({
      objects: [{ ...object, key: checksumKey }],
      truncated: true,
      cursor: "more",
      delimitedPrefixes: [],
    });
    const sendBatch = vi.spyOn(env.DOWNLOAD_QUEUE, "sendBatch").mockResolvedValue();
    const send = vi.spyOn(env.DOWNLOAD_QUEUE, "send").mockResolvedValue();
    await processChecksumBackfill({ type: "backfill-checksums" }, env);
    expect(sendBatch).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "backfill-checksums", cursor: "more" });
  });

  it("finishes an empty bucket without enqueueing empty batches", async () => {
    vi.spyOn(env.PACKAGES_BUCKET, "list").mockResolvedValue({
      objects: [],
      truncated: false,
      delimitedPrefixes: [],
    });
    const sendBatch = vi.spyOn(env.DOWNLOAD_QUEUE, "sendBatch").mockResolvedValue();
    const send = vi.spyOn(env.DOWNLOAD_QUEUE, "send").mockResolvedValue();
    await processChecksumBackfill({ type: "backfill-checksums" }, env);
    expect(sendBatch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("retries a failed page without advancing its cursor", async () => {
    const { object } = await seedZip("failed-page");
    vi.spyOn(env.PACKAGES_BUCKET, "list").mockResolvedValue({
      objects: [object],
      truncated: true,
      cursor: "more",
      delimitedPrefixes: [],
    });
    vi.spyOn(env.DOWNLOAD_QUEUE, "sendBatch").mockRejectedValue(new Error("Queue unavailable"));
    const send = vi.spyOn(env.DOWNLOAD_QUEUE, "send").mockResolvedValue();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await consume({ type: "backfill-checksums" });
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([{ msgId: "backfill-test" }]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("backfill checksum generation", () => {
  it("generates from R2 without upstream requests or D1 writes and skips duplicates", async () => {
    const { key, checksumKey, object } = await seedZip("generate");
    const fetch = vi.spyOn(globalThis, "fetch");
    const prepare = vi.spyOn(env.DB, "prepare");
    const message = { type: "generate-checksums", key } as const;
    expect((await consume(message)).explicitAcks).toEqual(["backfill-test"]);
    const manifest = await env.PACKAGES_BUCKET.get(checksumKey);
    expect(manifest!.httpMetadata?.contentType).toBe("application/json");
    expect(await manifest!.json()).toEqual({
      algorithm: "xxh128",
      files: { "Plugin/file.txt": "06b05ab6733a618578af5f94892f3950" },
    });
    const get = vi.spyOn(env.PACKAGES_BUCKET, "get");
    await processGenerateChecksums(message, env);
    expect(get).not.toHaveBeenCalled();
    expect((await env.PACKAGES_BUCKET.head(checksumKey))!.version).toBe(manifest!.version);
    expect((await env.PACKAGES_BUCKET.head(key))!.version).toBe(object.version);
    expect(fetch).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("skips ZIPs deleted after the scan", async () => {
    const result = await consume({
      type: "generate-checksums",
      key: "packages/store/deleted/1.zip",
    });
    expect(result.explicitAcks).toEqual(["backfill-test"]);
    expect(await env.PACKAGES_BUCKET.head("packages/store/deleted/1.checksums.json")).toBeNull();
  });

  it("retries invalid ZIPs without writing a manifest", async () => {
    await env.PACKAGES_BUCKET.put("packages/store/broken/1.zip", "invalid zip");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await consume({
      type: "generate-checksums",
      key: "packages/store/broken/1.zip",
    });
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([{ msgId: "backfill-test" }]);
    expect(await env.PACKAGES_BUCKET.head("packages/store/broken/1.checksums.json")).toBeNull();
  });

  it("recovers from a failed manifest write", async () => {
    const { key, checksumKey } = await seedZip("retry");
    const put = vi.spyOn(env.PACKAGES_BUCKET, "put").mockRejectedValue(new Error("R2 unavailable"));
    const message = { type: "generate-checksums", key } as const;
    await expect(processGenerateChecksums(message, env)).rejects.toThrow("R2 unavailable");
    put.mockRestore();
    await processGenerateChecksums(message, env);
    expect(await env.PACKAGES_BUCKET.head(checksumKey)).not.toBeNull();
  });
});
