import type { Context } from "hono";
import { inArray } from "drizzle-orm";
import { db, securityAdvisories } from "../db/db";

export async function getSecurityAdvisories(c: Context<{ Bindings: CloudflareBindings }>) {
  c.header("Cache-Control", "no-store");
  if (
    c.req.method === "POST" &&
    c.req.header("Content-Type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded"
  ) {
    return c.json({ error: "Expected application/x-www-form-urlencoded" }, 415);
  }

  const params =
    c.req.method === "POST"
      ? new URLSearchParams(await c.req.text())
      : new URL(c.req.url).searchParams;
  const names = new Set<string>();
  for (const [key, value] of params) {
    // PHP's http_build_query emits packages[0], packages[1], ...
    if (!/^packages\[(?:\d*)\]$/.test(key)) continue;
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value)) {
      return c.json({ error: "Invalid package name" }, 400);
    }
    names.add(value);
  }
  if (names.size > 1000) {
    return c.json({ error: "At most 1000 packages may be requested" }, 400);
  }

  type Advisory = Omit<typeof securityAdvisories.$inferSelect, "id">;
  const advisories: Record<string, Advisory[]> = {};
  const packageNames = [...names];
  // D1 allows at most 100 bound parameters per statement.
  for (let offset = 0; offset < packageNames.length; offset += 100) {
    const rows = await db
      .select()
      .from(securityAdvisories)
      .where(inArray(securityAdvisories.packageName, packageNames.slice(offset, offset + 100)))
      .orderBy(securityAdvisories.packageName, securityAdvisories.advisoryId);
    for (const { id: _id, ...advisory } of rows) {
      (advisories[advisory.packageName] ??= []).push(advisory);
    }
  }

  return c.json({ advisories });
}
