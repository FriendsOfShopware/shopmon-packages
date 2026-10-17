import { db, packages } from "./db/db";
import { createChecksumManifest } from "./checksums";
import type { DownloadPackageMessage, PurgePackageCacheMessage } from "./sync";

export async function processDownload(message: DownloadPackageMessage, env: CloudflareBindings) {
  const { name, version, composerJson, downloadUrl, token } = message;
  const r2Key = `packages/${name}/${version}.zip`;

  const checksumKey = `packages/${name}/${version}.checksums.json`;
  let object = await env.PACKAGES_BUCKET.head(r2Key);
  const alreadyDownloaded = object !== null;

  if (!object) {
    // Download from upstream
    let response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });

    // Follow redirects without auth (redirect target is a pre-signed S3 URL)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (location) {
        response = await fetch(new URL(location, downloadUrl).toString());
      }
    }

    if (!response.ok) {
      const errorMessage = await response.text();
      if (errorMessage === '"Plugin license not found."') {
        return;
      }
      throw new Error(
        `Failed to download ${name}@${version}: ${response.status} ${response.statusText} - ${errorMessage}`,
      );
    }

    // Upload to R2
    object = await env.PACKAGES_BUCKET.put(r2Key, response.body, {
      httpMetadata: { contentType: "application/zip" },
    });
  }

  if (!object) throw new Error(`Failed to store ${name}@${version}`);

  // Recover missing manifests on retries without downloading the ZIP again.
  if (!alreadyDownloaded || !(await env.PACKAGES_BUCKET.head(checksumKey))) {
    const manifest = await createChecksumManifest(env.PACKAGES_BUCKET, object);
    await env.PACKAGES_BUCKET.put(checksumKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  // Publish only after both the ZIP and its checksum manifest have been stored.
  await db.insert(packages).values({ name, version, composerJson }).onConflictDoNothing();

  // Enqueue cache invalidation for this package (deduplicated in batch handler)
  await env.DOWNLOAD_QUEUE.send({
    type: "purge-package-cache",
    name,
  } satisfies PurgePackageCacheMessage);
}
