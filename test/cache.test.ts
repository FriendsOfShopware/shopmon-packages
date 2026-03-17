import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";

async function seedToken(token: string, packages: Record<string, string[]>) {
  await env.DB.prepare("INSERT INTO tokens (token, source, packages) VALUES (?, ?, ?)")
    .bind(token, "default", JSON.stringify(packages))
    .run();
}

async function seedPackage(name: string, version: string) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO packages (name, version, composer_json) VALUES (?, ?, ?)",
  )
    .bind(name, version, JSON.stringify({ name, version }))
    .run();
}

describe("caching", () => {
  beforeAll(async () => {
    await seedToken("cache-token-1", { "vendor/plugin-a": ["1.0.0"] });
    await seedToken("cache-token-2", {
      "vendor/plugin-a": ["1.0.0"],
      "vendor/plugin-b": ["2.0.0"],
    });
    await seedPackage("vendor/plugin-a", "1.0.0");
    await seedPackage("vendor/plugin-b", "2.0.0");
  });

  it("should return cached response on second request to /packages.json", async () => {
    const res1 = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: "Bearer cache-token-1" },
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { "available-packages": string[] };
    expect(body1["available-packages"]).toEqual(["vendor/plugin-a"]);

    const res2 = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: "Bearer cache-token-1" },
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { "available-packages": string[] };
    expect(body2["available-packages"]).toEqual(["vendor/plugin-a"]);
  });

  it("should isolate cache per token", async () => {
    const resA = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: "Bearer cache-token-1" },
    });
    const bodyA = (await resA.json()) as { "available-packages": string[] };
    expect(bodyA["available-packages"]).toEqual(["vendor/plugin-a"]);

    const resB = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: "Bearer cache-token-2" },
    });
    const bodyB = (await resB.json()) as { "available-packages": string[] };
    expect(bodyB["available-packages"]).toEqual(["vendor/plugin-a", "vendor/plugin-b"]);
  });

  it("should cache /p2 package metadata", async () => {
    const res1 = await SELF.fetch("http://localhost/p2/vendor/plugin-a.json", {
      headers: { Authorization: "Bearer cache-token-1" },
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { packages: Record<string, unknown[]> };
    expect(body1.packages["vendor/plugin-a"]).toHaveLength(1);

    const res2 = await SELF.fetch("http://localhost/p2/vendor/plugin-a.json", {
      headers: { Authorization: "Bearer cache-token-1" },
    });
    expect(res2.status).toBe(200);
  });

  it("should reject unauthenticated and invalid-token requests", async () => {
    const res1 = await SELF.fetch("http://localhost/packages.json");
    expect(res1.status).toBe(401);

    const res2 = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res2.status).toBe(401);
  });

  it("should support Basic auth for cache", async () => {
    const res1 = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: `Basic ${btoa("user:cache-token-1")}` },
    });
    expect(res1.status).toBe(200);

    const res2 = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: `Basic ${btoa("user:cache-token-1")}` },
    });
    expect(res2.status).toBe(200);
  });
});
