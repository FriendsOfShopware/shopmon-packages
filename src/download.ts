import { db, packages } from "./db/db";
import type { DownloadPackageMessage, PurgePackageCacheMessage } from "./sync";

export async function processDownload(message: DownloadPackageMessage, env: CloudflareBindings) {
  const { name, version, composerJson, downloadUrl, token } = message;
  const r2Key = `packages/${name}/${version}.zip`;

  // Check if already in R2
  const existing = await env.PACKAGES_BUCKET.head(r2Key);
  if (existing) {
    await db.insert(packages).values({ name, version, composerJson }).onConflictDoNothing();
    return;
  }

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
  await env.PACKAGES_BUCKET.put(r2Key, response.body, {
    httpMetadata: { contentType: "application/zip" },
  });

  // Insert package into DB after successful download
  await db.insert(packages).values({ name, version, composerJson }).onConflictDoNothing();

  // Enqueue cache invalidation for this package (deduplicated in batch handler)
  await env.DOWNLOAD_QUEUE.send({
    type: "purge-package-cache",
    name,
  } satisfies PurgePackageCacheMessage);
}
