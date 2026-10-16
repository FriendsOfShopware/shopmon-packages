async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function extractBearerToken(request: Request): string | undefined {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    return decoded.split(":")[1];
  }
  return undefined;
}

// Responses are cached by Workers Cache in front of the Worker (wrangler.jsonc
// `cache.enabled`), which purgeByCacheTags can invalidate. Its key does not
// include the Authorization header, hence the Vary.
export async function withCacheHeaders(
  bearerToken: string,
  response: Response,
  extraTags: string[] = [],
): Promise<Response> {
  const hash = await hashToken(bearerToken);
  response.headers.set("Cache-Control", "s-maxage=2592000");
  response.headers.set("Vary", "Authorization");
  response.headers.set("Cache-Tag", [`t-${hash}`, ...extraTags].join(","));
  return response;
}

export async function purgeByCacheTags(
  tags: string[],
  env: CloudflareBindings,
  ctx: Partial<ExecutionContext>,
): Promise<void> {
  if (ctx.cache) {
    await ctx.cache.purge({ tags });
  } else {
    console.warn("ctx.cache is not available, skipping cache purge");
  }
}

export async function purgeByToken(
  bearerToken: string,
  env: CloudflareBindings,
  ctx: Partial<ExecutionContext>,
): Promise<void> {
  const tag = await hashToken(bearerToken);
  await purgeByCacheTags([`t-${tag}`], env, ctx);
}
