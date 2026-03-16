import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db, tokens } from "../db/db";

type TokenRow = typeof tokens.$inferSelect;

type AuthEnv = {
  Bindings: CloudflareBindings;
  Variables: { token: TokenRow };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.text("Unauthorized", 401);
  }

  const bearerToken = authHeader.slice(7);
  const token = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token, bearerToken))
    .get();

  if (!token) {
    return c.text("Unauthorized", 401);
  }

  c.set("token", token);
  await next();
});
