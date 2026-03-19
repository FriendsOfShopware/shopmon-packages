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

export async function purgeByCacheTags(tags: string[], env: CloudflareBindings): Promise<void> {
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;

  if (!zoneId || !apiToken) {
    console.warn("Missing CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN, skipping cache purge");
    return;
  }

  // Cloudflare allows max 30 tags per purge request
  for (let i = 0; i < tags.length; i += 30) {
    const chunk = tags.slice(i, i + 30);
    const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: chunk }),
    });

    if (!resp.ok) {
      console.error(`Cache purge failed: ${resp.status} ${await resp.text()}`);
    }
  }
}

export async function purgeByToken(bearerToken: string, env: CloudflareBindings): Promise<void> {
  const tag = await hashToken(bearerToken);
  await purgeByCacheTags([`t-${tag}`], env);
}
