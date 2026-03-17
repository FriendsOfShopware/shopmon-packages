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

  let bearerToken: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    bearerToken = authHeader.slice(7);
  } else if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    bearerToken = decoded.split(":")[1];
  }

  if (!bearerToken) {
    return c.text("Unauthorized", 401);
  }

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
