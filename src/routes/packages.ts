import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db, tokens, packages } from "../db/db";

type AuthContext = Context<{
  Bindings: CloudflareBindings;
  Variables: { token: typeof tokens.$inferSelect };
}>;

export async function getPackagesJson(c: AuthContext) {
  const token = c.get("token");

  return c.json({
    "metadata-url": "/p2/%package%.json",
    "available-packages": Object.keys(token.packages).sort(),
  });
}

export async function getPackageMetadata(c: AuthContext) {
  const token = c.get("token");
  const packageName = c.req.path.replace("/p2/", "").replace(".json", "");

  // Check if token has access to this package
  const allowedVersions = token.packages[packageName];
  if (!allowedVersions) {
    return c.notFound();
  }

  const allVersions = await db.select().from(packages).where(eq(packages.name, packageName));

  // Filter to only versions this token has access to
  const versionList = allVersions
    .filter((pkg) => allowedVersions.includes(pkg.version))
    .map((pkg) => {
      const composerData = { ...pkg.composerJson } as Record<string, unknown>;
      composerData.dist = {
        url: new URL(`/download/${pkg.name}/${pkg.version}`, c.req.url).toString(),
        type: "zip",
      };
      return composerData;
    });

  if (versionList.length === 0) {
    return c.notFound();
  }

  return c.json({
    packages: {
      [packageName]: versionList,
    },
  });
}

export async function downloadPackage(c: AuthContext) {
  const token = c.get("token");
  const path = c.req.path.replace("/download/", "");
  const lastSlash = path.lastIndexOf("/");
  const name = path.substring(0, lastSlash);
  const version = path.substring(lastSlash + 1);

  // Check if token has access to this package+version
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
