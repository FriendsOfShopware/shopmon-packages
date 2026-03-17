import { createMiddleware } from "hono/factory";
import { extractBearerToken, matchCache } from "../cache";

export const cacheMiddleware = createMiddleware(async (c, next) => {
  const bearerToken = extractBearerToken(c.req.raw);
  if (!bearerToken) {
    await next();
    return;
  }

  const cached = await matchCache(c.req.raw, bearerToken);
  if (cached) {
    return cached;
  }

  await next();
});
