import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";

async function seedToken(token: string, packages: Record<string, string[]>) {
  await env.DB.prepare("INSERT INTO tokens (token, source, packages) VALUES (?, ?, ?)")
    .bind(token, "default", JSON.stringify(packages))
    .run();
}

async function seedPackage(name: string, version: string, composerJson: Record<string, unknown>) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO packages (name, version, composer_json) VALUES (?, ?, ?)",
  )
    .bind(name, version, JSON.stringify(composerJson))
    .run();
}

async function seedR2(name: string, version: string, content: string) {
  await env.PACKAGES_BUCKET.put(`packages/${name}/${version}.zip`, content);
}

describe("composer package registry", () => {
  beforeAll(async () => {
    const composerJson = {
      name: "store/my-plugin",
      version: "1.2.0",
      type: "shopware-platform-plugin",
      description: "A test plugin",
    };

    await seedToken("registry-token", {
      "store/my-plugin": ["1.2.0"],
      "store/other-plugin": ["2.0.0"],
    });
    await seedPackage("store/my-plugin", "1.2.0", composerJson);
    await seedPackage("store/other-plugin", "2.0.0", {
      name: "store/other-plugin",
      version: "2.0.0",
    });
    await seedR2("store/my-plugin", "1.2.0", "fake-zip-content");
  });

  it("GET /packages.json returns metadata-url and available packages", async () => {
    const res = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: "Bearer registry-token" },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      "metadata-url": string;
      "available-packages": string[];
    };
    expect(body["metadata-url"]).toBe("/p2/%package%.json");
    expect(body["available-packages"]).toEqual(["store/my-plugin", "store/other-plugin"]);
  });

  it("GET /p2/{package}.json returns composer metadata with dist url", async () => {
    const res = await SELF.fetch("http://localhost/p2/store/my-plugin.json", {
      headers: { Authorization: "Bearer registry-token" },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      packages: Record<string, Array<Record<string, unknown>>>;
    };
    const versions = body.packages["store/my-plugin"];
    expect(versions).toHaveLength(1);

    const pkg = versions[0];
    expect(pkg.name).toBe("store/my-plugin");
    expect(pkg.version).toBe("1.2.0");
    expect(pkg.type).toBe("shopware-platform-plugin");
    expect(pkg.dist).toEqual({
      url: "http://localhost/download/store/my-plugin/1.2.0",
      type: "zip",
    });
  });

  it("GET /p2/{package}.json returns 404 for packages not in token scope", async () => {
    const res = await SELF.fetch("http://localhost/p2/store/unknown-plugin.json", {
      headers: { Authorization: "Bearer registry-token" },
    });
    expect(res.status).toBe(404);
  });

  it("GET /download/{package}/{version} returns the zip from R2", async () => {
    const res = await SELF.fetch("http://localhost/download/store/my-plugin/1.2.0", {
      headers: { Authorization: "Bearer registry-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("store-my-plugin-1.2.0.zip");

    const body = await res.text();
    expect(body).toBe("fake-zip-content");
  });

  it("GET /download returns 403 for packages not in token scope", async () => {
    const res = await SELF.fetch("http://localhost/download/store/my-plugin/9.9.9", {
      headers: { Authorization: "Bearer registry-token" },
    });
    expect(res.status).toBe(403);
  });

  it("GET /download returns 404 when zip is missing from R2", async () => {
    const res = await SELF.fetch("http://localhost/download/store/other-plugin/2.0.0", {
      headers: { Authorization: "Bearer registry-token" },
    });
    expect(res.status).toBe(404);
  });
});
