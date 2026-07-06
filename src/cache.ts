function getCache() {
  return caches.default;
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildCacheKey(request: Request, tokenHash: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("_t", tokenHash);
  return new Request(url.toString(), { method: "GET" });
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

export async function matchCache(
  request: Request,
  bearerToken: string,
): Promise<Response | undefined> {
  const hash = await hashToken(bearerToken);
  return (await getCache().match(buildCacheKey(request, hash))) ?? undefined;
}

export async function putCache(
  request: Request,
  bearerToken: string,
  response: Response,
  extraTags: string[] = [],
): Promise<void> {
  const hash = await hashToken(bearerToken);
  const cached = new Response(response.body, response);
  cached.headers.set("Cache-Control", "s-maxage=2592000");
  cached.headers.set("Cache-Tag", [`t-${hash}`, ...extraTags].join(","));
  await getCache().put(buildCacheKey(request, hash), cached);
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
