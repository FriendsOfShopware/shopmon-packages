import { createMiddleware } from "hono/factory";

export const adminAuthMiddleware = createMiddleware<{ Bindings: CloudflareBindings & { API_TOKEN: string } }>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  if (token !== c.env.API_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});
