import { eq, inArray } from "drizzle-orm";
import { db, tokens, packages } from "./db/db";

interface UpstreamPackageVersion {
  name: string;
  version: string;
  dist: { url: string; type: string };
  [key: string]: unknown;
}

interface UpstreamResponse {
  packages: Record<string, Record<string, UpstreamPackageVersion>>;
}

export interface SyncTokenMessage {
  type: "sync-token";
  tokenId: number;
}

export interface DownloadPackageMessage {
  type: "download-package";
  name: string;
  version: string;
  composerJson: Record<string, unknown>;
  downloadUrl: string;
  token: string;
}

export type QueueMessage = SyncTokenMessage | DownloadPackageMessage;

export async function enqueueSyncForAllTokens(env: CloudflareBindings) {
  const allTokens = await db.select({ id: tokens.id, token: tokens.token }).from(tokens);

  const seen = new Set<string>();
  for (const token of allTokens) {
    if (seen.has(token.token)) continue;
    seen.add(token.token);

    await env.DOWNLOAD_QUEUE.send({
      type: "sync-token",
      tokenId: token.id,
    } satisfies SyncTokenMessage);
  }
}

export async function processSyncToken(tokenId: number, env: CloudflareBindings) {
  const token = await db.select().from(tokens).where(eq(tokens.id, tokenId)).get();

  if (!token) {
    console.error(`Token ${tokenId} not found`);
    return;
  }

  console.log(`Syncing token ${token.id}...`);

  const response = await fetch("https://packages.shopware.com/packages.json", {
    headers: { Authorization: `Bearer ${token.token}` },
  });

  if (!response.ok) {
    console.error(`Failed to fetch packages for token ${token.id}: ${response.status}`);
    return;
  }

  const data = (await response.json()) as UpstreamResponse;
  const tokenPackages: Record<string, string[]> = {};

  const packageNames = Object.keys(data.packages);
  for (const name of packageNames) {
    tokenPackages[name] = Object.keys(data.packages[name]);
  }

  // Query existing versions for these package names
  const existingPackages = new Set<string>();
  for (let i = 0; i < packageNames.length; i += 90) {
    const chunk = packageNames.slice(i, i + 90);
    const rows = await db
      .select({ name: packages.name, version: packages.version })
      .from(packages)
      .where(inArray(packages.name, chunk));
    for (const row of rows) {
      existingPackages.add(`${row.name}@${row.version}`);
    }
  }

  const downloadBatch: { body: DownloadPackageMessage }[] = [];

  for (const [packageName, versions] of Object.entries(data.packages)) {
    for (const [versionStr, composerData] of Object.entries(versions)) {
      if (existingPackages.has(`${packageName}@${versionStr}`)) {
        continue;
      }

      downloadBatch.push({
        body: {
          type: "download-package",
          name: packageName,
          version: versionStr,
          composerJson: composerData as Record<string, unknown>,
          downloadUrl: composerData.dist.url,
          token: token.token,
        },
      });
    }
  }

  // Send download jobs in batches (max 100 per sendBatch call)
  for (let i = 0; i < downloadBatch.length; i += 100) {
    await env.DOWNLOAD_QUEUE.sendBatch(downloadBatch.slice(i, i + 100));
  }

  await db
    .update(tokens)
    .set({
      packages: tokenPackages,
      lastSyncedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(tokens.token, token.token));

    console.log(`Finished syncing token ${token.id}`);
}
