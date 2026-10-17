import type { Context } from "hono";

export async function getPublicChecksums(c: Context<{ Bindings: CloudflareBindings }>) {
  // Do not cache missing manifests (including while a backfill is running) or errors.
  c.header("Cache-Control", "no-store");
  const segments = [c.req.param("vendor"), c.req.param("name"), c.req.param("version")];
  if (
    segments.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[/\\]/.test(part) ||
        [...part].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
    )
  ) {
    return c.notFound();
  }

  const [vendor, name, version] = segments;
  const object = await c.env.PACKAGES_BUCKET.get(
    `packages/${vendor}/${name}/${version}.checksums.json`,
  );
  if (!object) return c.notFound();

  // Versioned manifests are immutable and identical for every caller.
  return c.body(object.body, 200, {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: object.httpEtag,
    "X-Content-Type-Options": "nosniff",
  });
}
