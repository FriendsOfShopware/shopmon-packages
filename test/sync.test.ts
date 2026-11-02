import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { processSyncToken, type DownloadPackageMessage } from "../src/sync";

// Cloudflare Queues limits (1 KB = 1000 bytes):
// https://developers.cloudflare.com/queues/platform/limits/
const MAX_MESSAGES_PER_BATCH = 100;
const MAX_BATCH_BYTES = 256_000;
const MAX_MESSAGE_BYTES = 128_000;
// Messages include ~100 bytes of internal metadata that counts towards limits.
const MESSAGE_OVERHEAD_BYTES = 100;

const encoder = new TextEncoder();

function messageBytes(body: unknown) {
  return encoder.encode(JSON.stringify(body)).byteLength + MESSAGE_OVERHEAD_BYTES;
}

afterEach(() => vi.restoreAllMocks());

async function seedToken(token: string) {
  const row = await env.DB.prepare("INSERT INTO tokens (token) VALUES (?) RETURNING id")
    .bind(token)
    .first<{ id: number }>();
  return row!.id;
}

function upstreamPayload(name: string, versions: string[], descriptionLength: number) {
  return {
    packages: {
      [name]: Object.fromEntries(
        versions.map((version) => [
          version,
          {
            name,
            version,
            description: "x".repeat(descriptionLength),
            dist: { url: `https://upstream.example/${name}/${version}.zip`, type: "zip" },
          },
        ]),
      ),
    },
  };
}

async function sync(token: string, payload: unknown) {
  const tokenId = await seedToken(token);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const sendBatch = vi.spyOn(env.DOWNLOAD_QUEUE, "sendBatch").mockResolvedValue();

  await processSyncToken(tokenId, env, createExecutionContext());

  const batches: DownloadPackageMessage[][] = sendBatch.mock.calls.map(
    (call: [Iterable<MessageSendRequest<DownloadPackageMessage>>]) =>
      [...call[0]].map((message) => message.body),
  );
  return { tokenId, batches };
}

function expectBatchesWithinQueueLimits(batches: DownloadPackageMessage[][]) {
  expect(batches.length).toBeGreaterThan(1);
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(MAX_MESSAGES_PER_BATCH);
    const batchBytes = batch.reduce((total, body) => total + messageBytes(body), 0);
    expect(batchBytes).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    for (const body of batch) {
      expect(messageBytes(body)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    }
  }
}

describe("processSyncToken queue batching", () => {
  it("splits 100 large download jobs into batches within the 256 KB limit", async () => {
    const name = "store/batch-size-plugin";
    const versions = Array.from({ length: 100 }, (_, i) => `1.0.${i}`);

    // ~4.5 KB of metadata per version puts a naive batch of 100 at ~450 KB,
    // which Cloudflare rejects: "batch size ... exceeds limit of 256000 bytes (10205)".
    const { tokenId, batches } = await sync(
      "batch-size-token",
      upstreamPayload(name, versions, 4_500),
    );

    expectBatchesWithinQueueLimits(batches);
    expect(batches.flat().map((body) => body.version)).toEqual(versions);
    expect(
      batches.flat().every((body) => body.type === "download-package" && body.name === name),
    ).toBe(true);

    // The sync completes past the enqueue step.
    const token = await env.DB.prepare("SELECT packages, last_synced_at FROM tokens WHERE id = ?")
      .bind(tokenId)
      .first<{ packages: string; last_synced_at: number }>();
    expect(token!.last_synced_at).not.toBeNull();
    expect(JSON.parse(token!.packages)).toEqual({ [name]: versions });
  });

  it("splits jobs near the per-message limit across batches", async () => {
    const name = "store/large-message-plugin";
    const versions = ["1.0.0", "1.0.1", "1.0.2"];

    // Each job is ~120 KB: legal on its own, but all three exceed 256 KB together.
    const { batches } = await sync("large-message-token", upstreamPayload(name, versions, 120_000));

    expectBatchesWithinQueueLimits(batches);
    expect(batches.flat().map((body) => body.version)).toEqual(versions);
  });
});
