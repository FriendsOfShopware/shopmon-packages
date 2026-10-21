import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";

const advisory = {
  packageName: "store/vulnerable-plugin",
  advisoryId: "TEST-001",
  affectedVersions: ">=1.0.0 <1.2.3",
  title: "Example vulnerability",
  reportedAt: "2026-10-21T00:00:00Z",
  sources: [{ name: "example", remoteId: "TEST-001" }],
  cve: null,
  link: "https://example.com/advisories/TEST-001",
  severity: "high",
};

describe("Composer security advisory API", () => {
  beforeAll(async () => {
    // Exercise the external writer contract directly, without an importer.
    for (const advisoryId of ["TEST-001", "TEST-002"]) {
      await env.DB.prepare(`INSERT INTO security_advisories
        (package_name, advisory_id, affected_versions, title, reported_at, sources, link, severity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          advisory.packageName,
          advisoryId,
          advisory.affectedVersions,
          advisory.title,
          advisory.reportedAt,
          JSON.stringify(advisory.sources),
          advisory.link,
          advisory.severity,
        )
        .run();
    }
  });

  it.each(["packages[]", "packages[0]"])(
    "accepts Composer form encoding %s without auth",
    async (key) => {
      const res = await SELF.fetch("http://localhost/security-advisories.json", {
        method: "POST",
        body: new URLSearchParams([
          [key, advisory.packageName],
          ["packages[1]", "store/clean"],
        ]),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({
        advisories: {
          [advisory.packageName]: [advisory, { ...advisory, advisoryId: "TEST-002" }],
        },
      });
    },
  );

  it("supports GET and deduplicates requested names across D1 query batches", async () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 110; i++) params.append("packages[]", `store/clean-${i}`);
    params.append("packages[]", advisory.packageName);
    params.append("packages[]", advisory.packageName);
    const res = await SELF.fetch(`http://localhost/security-advisories.json?${params}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      advisories: {
        [advisory.packageName]: [advisory, { ...advisory, advisoryId: "TEST-002" }],
      },
    });
  });

  it.each(["", "?packages[]=store/clean"])(
    "returns an empty object for no matches (%s)",
    async (query) => {
      const res = await SELF.fetch(`http://localhost/security-advisories.json${query}`);
      expect(await res.json()).toEqual({ advisories: {} });
    },
  );

  it("rejects unsupported bodies and invalid package names", async () => {
    const json = await SELF.fetch("http://localhost/security-advisories.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(json.status).toBe(415);
    const invalid = await SELF.fetch(
      "http://localhost/security-advisories.json?packages[]=invalid",
    );
    expect(invalid.status).toBe(400);
  });

  it("rejects oversized requests", async () => {
    const res = await SELF.fetch("http://localhost/security-advisories.json", {
      method: "POST",
      body: new URLSearchParams({ "packages[]": "x".repeat(1024 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it("rejects too many packages without silently truncating", async () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 1001; i++) params.append("packages[]", `store/plugin-${i}`);
    const res = await SELF.fetch("http://localhost/security-advisories.json", {
      method: "POST",
      body: params,
    });
    expect(res.status).toBe(400);
  });
});
