import { createChecksumManifest } from "./checksums";

export interface BackfillChecksumsMessage {
  type: "backfill-checksums";
  cursor?: string;
}

export interface GenerateChecksumsMessage {
  type: "generate-checksums";
  key: string;
}

// One page per queue message keeps scans bounded, even for large buckets.
export async function processChecksumBackfill(
  message: BackfillChecksumsMessage,
  env: CloudflareBindings,
) {
  const page = await env.PACKAGES_BUCKET.list({
    prefix: "packages/",
    limit: 100,
    cursor: message.cursor,
  });
  const jobs = page.objects
    .filter((object) => object.key.endsWith(".zip"))
    .map((object) => ({
      body: { type: "generate-checksums", key: object.key } satisfies GenerateChecksumsMessage,
    }));

  if (jobs.length > 0) await env.DOWNLOAD_QUEUE.sendBatch(jobs);

  // Only advance after every job in this page is durably enqueued. A retry may
  // enqueue duplicates, but generation skips manifests that already exist.
  if (page.truncated) {
    await env.DOWNLOAD_QUEUE.send({
      type: "backfill-checksums",
      cursor: page.cursor,
    } satisfies BackfillChecksumsMessage);
  }

  console.log(
    JSON.stringify({
      event: "checksum-backfill-page",
      scanned: page.objects.length,
      enqueued: jobs.length,
      hasMore: page.truncated,
    }),
  );
}

export async function processGenerateChecksums(
  message: GenerateChecksumsMessage,
  env: CloudflareBindings,
) {
  const { key } = message;
  if (!key.startsWith("packages/") || !key.endsWith(".zip")) {
    throw new Error(`Invalid checksum backfill ZIP key: ${key}`);
  }
  const checksumKey = `${key.slice(0, -4)}.checksums.json`;
  if (await env.PACKAGES_BUCKET.head(checksumKey)) return;

  const object = await env.PACKAGES_BUCKET.head(key);
  if (!object) {
    // A ZIP can be deleted between listing the bucket and consuming its job.
    console.log(JSON.stringify({ event: "checksum-backfill-missing-zip", key }));
    return;
  }

  const manifest = await createChecksumManifest(env.PACKAGES_BUCKET, object);
  await env.PACKAGES_BUCKET.put(checksumKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  console.log(JSON.stringify({ event: "checksum-backfill-generated", key }));
}
