import type { Context } from "hono";
import { eq, max, sql } from "drizzle-orm";
import { db, packages, tokens } from "../db/db";

type PublicPackage = {
  name: string;
  description: string | null;
  latestVersion: string;
  versions: string[];
};

// Compares composer-style versions ("2.1.0", "v1.0.0-rc1") newest-first.
function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string) => {
    const [release, preRelease] = v.replace(/^v/i, "").split("-", 2);
    return {
      parts: release.split(".").map((p) => Number.parseInt(p, 10) || 0),
      preRelease: preRelease ?? null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < Math.max(pa.parts.length, pb.parts.length); i++) {
    const diff = (pb.parts[i] ?? 0) - (pa.parts[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  // A release is newer than its own pre-releases.
  if (pa.preRelease === pb.preRelease) {
    return 0;
  }
  if (pa.preRelease === null) {
    return -1;
  }
  if (pb.preRelease === null) {
    return 1;
  }
  return pb.preRelease.localeCompare(pa.preRelease);
}

export async function getPublicPackageDetail(c: Context<{ Bindings: CloudflareBindings }>) {
  const name = `${c.req.param("vendor")}/${c.req.param("name")}`;

  const rows = await db
    .select({ version: packages.version, composerJson: packages.composerJson })
    .from(packages)
    .where(eq(packages.name, name));

  if (rows.length === 0) {
    return c.notFound();
  }

  const versions = rows
    .map((row) => {
      const composer = row.composerJson as {
        time?: string;
        license?: string | string[];
        require?: Record<string, string>;
      };
      return {
        version: row.version,
        releasedAt: composer.time ?? null,
        shopwareCore: composer.require?.["shopware/core"] ?? null,
      };
    })
    .sort((a, b) => compareVersionsDesc(a.version, b.version));

  const latest = rows.find((row) => row.version === versions[0].version)?.composerJson as {
    description?: string;
    type?: string;
    homepage?: string;
    license?: string | string[];
  };

  return c.json(
    {
      name,
      description: latest.description ?? null,
      type: latest.type ?? null,
      homepage: latest.homepage ?? null,
      license: [latest.license ?? []].flat().join(", ") || null,
      latestVersion: versions[0].version,
      versions,
    },
    200,
    { "Cache-Control": "public, max-age=300" },
  );
}

export async function listPublicPackages(c: Context<{ Bindings: CloudflareBindings }>) {
  const rows = await db
    .select({
      name: packages.name,
      version: packages.version,
      description: sql<string | null>`json_extract(${packages.composerJson}, '$.description')`,
    })
    .from(packages);

  const byName = new Map<string, { description: string | null; versions: string[] }>();
  for (const row of rows) {
    const entry = byName.get(row.name) ?? { description: null, versions: [] };
    entry.versions.push(row.version);
    entry.description ??= row.description;
    byName.set(row.name, entry);
  }

  const packageList: PublicPackage[] = [...byName.entries()]
    .map(([name, entry]) => {
      const versions = entry.versions.sort(compareVersionsDesc);
      return {
        name,
        description: entry.description,
        latestVersion: versions[0],
        versions,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const [sync] = await db.select({ lastSyncedAt: max(tokens.lastSyncedAt) }).from(tokens);

  return c.json(
    {
      packages: packageList,
      totalPackages: packageList.length,
      totalVersions: rows.length,
      lastSyncedAt: sync?.lastSyncedAt ?? null,
    },
    200,
    { "Cache-Control": "public, max-age=300" },
  );
}
