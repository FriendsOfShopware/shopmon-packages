import type { Context } from "hono";
import { eq, and } from "drizzle-orm";
import { unzipSync } from "fflate";
import { db, tokens, customPackages } from "../db/db";

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
const COMPOSER_NAME_REGEX = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9]([_.-]?[a-z0-9]+)*$/;

async function resolveToken(c: Context<{ Bindings: CloudflareBindings }>) {
  const id = Number(c.req.param("id"));
  const token = await db.select({ id: tokens.id }).from(tokens).where(eq(tokens.id, id)).get();
  if (!token) {
    return null;
  }
  return token;
}

export async function uploadPackage(c: Context<{ Bindings: CloudflareBindings }>) {
  const token = await resolveToken(c);
  if (!token) {
    return c.json({ error: "Token not found" }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return c.json({ error: "file is required" }, 400);
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return c.json({ error: "File exceeds 50MB limit" }, 400);
  }

  const zipData = new Uint8Array(await file.arrayBuffer());

  // Validate zip magic bytes
  if (zipData[0] !== 0x50 || zipData[1] !== 0x4b || zipData[2] !== 0x03 || zipData[3] !== 0x04) {
    return c.json({ error: "File is not a valid zip archive" }, 400);
  }

  // Extract composer.json from zip
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipData);
  } catch {
    return c.json({ error: "Failed to extract zip archive" }, 400);
  }

  let composerJsonContent: string | undefined;
  for (const [path, data] of Object.entries(unzipped)) {
    const normalized = path.replace(/^[^/]+\//, "");
    if (normalized === "composer.json" || path === "composer.json") {
      composerJsonContent = new TextDecoder().decode(data);
      break;
    }
  }

  if (!composerJsonContent) {
    return c.json({ error: "No composer.json found in archive" }, 400);
  }

  let composerJson: Record<string, unknown>;
  try {
    composerJson = JSON.parse(composerJsonContent);
  } catch {
    return c.json({ error: "Invalid composer.json" }, 400);
  }

  const name = composerJson.name as string | undefined;
  const version = composerJson.version as string | undefined;

  if (!name || typeof name !== "string") {
    return c.json({ error: "composer.json must contain a name field" }, 400);
  }

  if (!version || typeof version !== "string") {
    return c.json({ error: "composer.json must contain a version field" }, 400);
  }

  if (!COMPOSER_NAME_REGEX.test(name)) {
    return c.json({ error: "Invalid package name format (must be vendor/package)" }, 400);
  }

  // Upload to R2
  const r2Key = `custom/${token.id}/${name}/${version}.zip`;
  await c.env.PACKAGES_BUCKET.put(r2Key, zipData, {
    httpMetadata: { contentType: "application/zip" },
  });

  // Upsert into database
  const result = await db
    .insert(customPackages)
    .values({
      tokenId: token.id,
      name,
      version,
      composerJson,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoUpdate({
      target: [customPackages.tokenId, customPackages.name, customPackages.version],
      set: {
        composerJson,
        createdAt: Math.floor(Date.now() / 1000),
      },
    })
    .returning()
    .get();

  return c.json(result, 201);
}

export async function listCustomPackages(c: Context<{ Bindings: CloudflareBindings }>) {
  const token = await resolveToken(c);
  if (!token) {
    return c.json({ error: "Token not found" }, 404);
  }

  const pkgs = await db
    .select({
      id: customPackages.id,
      name: customPackages.name,
      version: customPackages.version,
      createdAt: customPackages.createdAt,
    })
    .from(customPackages)
    .where(eq(customPackages.tokenId, token.id));

  return c.json(pkgs);
}

export async function deleteCustomPackage(c: Context<{ Bindings: CloudflareBindings }>) {
  const token = await resolveToken(c);
  if (!token) {
    return c.json({ error: "Token not found" }, 404);
  }

  const vendor = c.req.param("vendor");
  const name = c.req.param("name");
  const version = c.req.param("version");
  const fullName = `${vendor}/${name}`;

  const deleted = await db
    .delete(customPackages)
    .where(
      and(
        eq(customPackages.tokenId, token.id),
        eq(customPackages.name, fullName),
        eq(customPackages.version, version),
      ),
    )
    .returning()
    .get();

  if (!deleted) {
    return c.json({ error: "Package not found" }, 404);
  }

  // Remove from R2
  await c.env.PACKAGES_BUCKET.delete(`custom/${token.id}/${fullName}/${version}.zip`);

  return c.json({ success: true });
}
