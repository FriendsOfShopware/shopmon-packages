import type { Context } from "hono";
import { eq, and } from "drizzle-orm";
import { db, tokens } from "../db/db";
import type { SyncTokenMessage } from "../sync";

export async function createToken(c: Context<{ Bindings: CloudflareBindings }>) {
  const body = await c.req.json<{ token: string; source?: string }>();

  if (!body.token) {
    return c.json({ error: "token is required" }, 400);
  }

  const result = await db
    .insert(tokens)
    .values({ token: body.token, ...(body.source ? { source: body.source } : {}) })
    .returning()
    .get();

  return c.json(result, 201);
}

export async function listTokens(c: Context<{ Bindings: CloudflareBindings }>) {
  const source = c.req.query("source");

  const allTokens = await db.select({
    id: tokens.id,
    source: tokens.source,
    lastSyncedAt: tokens.lastSyncedAt,
  }).from(tokens).where(source ? eq(tokens.source, source) : undefined);

  return c.json(allTokens);
}

export async function deleteToken(c: Context<{ Bindings: CloudflareBindings }>) {
  const id = Number(c.req.param("id"));

  const deleted = await db.delete(tokens).where(eq(tokens.id, id)).returning().get();

  if (!deleted) {
    return c.json({ error: "Token not found" }, 404);
  }

  return c.json({ success: true });
}

export async function syncToken(c: Context<{ Bindings: CloudflareBindings }>) {
  const id = Number(c.req.param("id"));

  const token = await db.select({ id: tokens.id }).from(tokens).where(eq(tokens.id, id)).get();

  if (!token) {
    return c.json({ error: "Token not found" }, 404);
  }

  await c.env.DOWNLOAD_QUEUE.send({
    type: "sync-token",
    tokenId: token.id,
  } satisfies SyncTokenMessage);

  return c.json({ success: true });
}
