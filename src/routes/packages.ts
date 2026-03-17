import type { Context } from "hono";
import { eq, and } from "drizzle-orm";
import { db, tokens, packages, customPackages } from "../db/db";

type AuthContext = Context<{
  Bindings: CloudflareBindings;
  Variables: { token: typeof tokens.$inferSelect };
}>;

export async function getPackagesJson(c: AuthContext) {
  const token = c.get("token");

  const customNames = await db
    .selectDistinct({ name: customPackages.name })
    .from(customPackages)
    .where(eq(customPackages.tokenId, token.id));

  const mirroredNames = Object.keys(token.packages);
  const allNames = [...new Set([...mirroredNames, ...customNames.map((r) => r.name)])].sort();

  return c.json({
    "metadata-url": "/p2/%package%.json",
    "available-packages": allNames,
  });
}

export async function getPackageMetadata(c: AuthContext) {
  const token = c.get("token");
  const packageName = c.req.path.replace("/p2/", "").replace(".json", "");

  // Mirrored versions
  const allowedVersions = token.packages[packageName];
  let mirroredVersionList: Record<string, unknown>[] = [];
  if (allowedVersions) {
    const allVersions = await db.select().from(packages).where(eq(packages.name, packageName));
    mirroredVersionList = allVersions
      .filter((pkg) => allowedVersions.includes(pkg.version))
      .map((pkg) => {
        const composerData = { ...pkg.composerJson } as Record<string, unknown>;
        composerData.dist = {
          url: new URL(`/download/${pkg.name}/${pkg.version}`, c.req.url).toString(),
          type: "zip",
        };
        return composerData;
      });
  }

  // Custom versions
  const customVersions = await db
    .select()
    .from(customPackages)
    .where(and(eq(customPackages.tokenId, token.id), eq(customPackages.name, packageName)));

  const customVersionList = customVersions.map((pkg) => {
    const composerData = { ...pkg.composerJson } as Record<string, unknown>;
    composerData.dist = {
      url: new URL(`/download/${pkg.name}/${pkg.version}`, c.req.url).toString(),
      type: "zip",
    };
    return composerData;
  });

  // Merge: custom takes precedence over mirrored for same version
  const customVersionSet = new Set(customVersions.map((v) => v.version));
  const merged = [
    ...mirroredVersionList.filter((v) => !customVersionSet.has(v.version as string)),
    ...customVersionList,
  ];

  if (merged.length === 0) {
    return c.notFound();
  }

  return c.json({
    packages: {
      [packageName]: merged,
    },
  });
}

export async function downloadPackage(c: AuthContext) {
  const token = c.get("token");
  const path = c.req.path.replace("/download/", "");
  const lastSlash = path.lastIndexOf("/");
  const name = path.substring(0, lastSlash);
  const version = path.substring(lastSlash + 1);

  // Check for custom package first
  const customPkg = await db
    .select({ id: customPackages.id })
    .from(customPackages)
    .where(
      and(
        eq(customPackages.tokenId, token.id),
        eq(customPackages.name, name),
        eq(customPackages.version, version),
      ),
    )
    .get();

  if (customPkg) {
    const r2Key = `custom/${token.id}/${name}/${version}.zip`;
    const object = await c.env.PACKAGES_BUCKET.get(r2Key);
    if (!object) {
      return c.text("Package not found", 404);
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name.replace(/\//g, "-")}-${version}.zip"`,
      },
    });
  }

  // Fall back to mirrored package
  const allowedVersions = token.packages[name];
  if (!allowedVersions || !allowedVersions.includes(version)) {
    return c.text("Forbidden", 403);
  }

  const r2Key = `packages/${name}/${version}.zip`;
  const object = await c.env.PACKAGES_BUCKET.get(r2Key);

  if (!object) {
    return c.text("Package not found", 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name.replace(/\//g, "-")}-${version}.zip"`,
    },
  });
}
