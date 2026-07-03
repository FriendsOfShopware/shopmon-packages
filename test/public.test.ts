import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";

async function seedPackage(name: string, version: string, composerJson: Record<string, unknown>) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO packages (name, version, composer_json) VALUES (?, ?, ?)",
  )
    .bind(name, version, JSON.stringify(composerJson))
    .run();
}

type PublicListing = {
  packages: {
    name: string;
    description: string | null;
    latestVersion: string;
    versions: string[];
  }[];
  totalPackages: number;
  totalVersions: number;
  lastSyncedAt: number | null;
};

describe("public package listing", () => {
  beforeAll(async () => {
    await seedPackage("store/alpha", "1.0.0", {
      name: "store/alpha",
      version: "1.0.0",
      description: "Alpha plugin",
    });
    await seedPackage("store/alpha", "1.10.0", {
      name: "store/alpha",
      version: "1.10.0",
      description: "Alpha plugin",
      time: "2024-06-01T00:00:00+00:00",
      license: "proprietary",
      require: { "shopware/core": ">=6.6 <6.8" },
    });
    await seedPackage("store/alpha", "1.2.0", {
      name: "store/alpha",
      version: "1.2.0",
      description: "Alpha plugin",
    });
    await seedPackage("store/beta", "2.0.0", {
      name: "store/beta",
      version: "2.0.0",
    });
  });

  it("GET /api/public/packages lists packages without authentication", async () => {
    const res = await SELF.fetch("http://localhost/api/public/packages");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");

    const body = (await res.json()) as PublicListing;
    expect(body.totalPackages).toBe(2);
    expect(body.totalVersions).toBe(4);

    const [alpha, beta] = body.packages;
    expect(alpha.name).toBe("store/alpha");
    expect(alpha.description).toBe("Alpha plugin");
    expect(alpha.latestVersion).toBe("1.10.0");
    expect(alpha.versions).toEqual(["1.10.0", "1.2.0", "1.0.0"]);

    expect(beta.name).toBe("store/beta");
    expect(beta.description).toBeNull();
    expect(beta.latestVersion).toBe("2.0.0");
  });

  it("GET /api/public/packages/:vendor/:name returns version details", async () => {
    const res = await SELF.fetch("http://localhost/api/public/packages/store/alpha");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      name: string;
      description: string | null;
      license: string | null;
      latestVersion: string;
      versions: { version: string; releasedAt: string | null; shopwareCore: string | null }[];
    };
    expect(body.name).toBe("store/alpha");
    expect(body.description).toBe("Alpha plugin");
    expect(body.latestVersion).toBe("1.10.0");
    expect(body.versions.map((v) => v.version)).toEqual(["1.10.0", "1.2.0", "1.0.0"]);
    expect(body.versions[0].releasedAt).toBe("2024-06-01T00:00:00+00:00");
    expect(body.versions[0].shopwareCore).toBe(">=6.6 <6.8");
  });

  it("GET /api/public/packages/:vendor/:name returns 404 for unknown packages", async () => {
    const res = await SELF.fetch("http://localhost/api/public/packages/store/missing");
    expect(res.status).toBe(404);
  });

  it("GET /api/tokens still requires the admin token", async () => {
    const res = await SELF.fetch("http://localhost/api/tokens");
    expect(res.status).toBe(401);
  });
});
