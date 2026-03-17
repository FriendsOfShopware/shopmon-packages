import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { zipSync } from "fflate";

const AUTH = { Authorization: "Bearer test-api-token" };

function createZip(composerJson: Record<string, unknown>): Uint8Array {
  return zipSync({
    "composer.json": new TextEncoder().encode(JSON.stringify(composerJson)),
  });
}

async function createToken(token = "test-token") {
  const res = await SELF.fetch("http://localhost/api/tokens", {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return (await res.json()) as { id: number; token: string };
}

function uploadPackage(tokenId: number, zip: Uint8Array) {
  const form = new FormData();
  form.append("file", new File([zip], "package.zip", { type: "application/zip" }));
  return SELF.fetch(`http://localhost/api/tokens/${tokenId}/packages`, {
    method: "POST",
    headers: AUTH,
    body: form,
  });
}

describe("custom packages API", () => {
  let tokenId: number;

  beforeEach(async () => {
    const token = await createToken(`token-${Date.now()}-${Math.random()}`);
    tokenId = token.id;
  });

  it("should upload a custom package", async () => {
    const zip = createZip({
      name: "acme/my-plugin",
      version: "1.0.0",
      type: "shopware-platform-plugin",
    });
    const res = await uploadPackage(tokenId, zip);

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "acme/my-plugin",
      version: "1.0.0",
      tokenId,
    });
  });

  it("should list custom packages", async () => {
    const zip = createZip({ name: "acme/my-plugin", version: "1.0.0" });
    await uploadPackage(tokenId, zip);

    const res = await SELF.fetch(`http://localhost/api/tokens/${tokenId}/packages`, {
      headers: AUTH,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: "acme/my-plugin", version: "1.0.0" });
  });

  it("should delete a custom package", async () => {
    const zip = createZip({ name: "acme/my-plugin", version: "1.0.0" });
    await uploadPackage(tokenId, zip);

    const res = await SELF.fetch(
      `http://localhost/api/tokens/${tokenId}/packages/acme/my-plugin/1.0.0`,
      {
        method: "DELETE",
        headers: AUTH,
      },
    );

    expect(res.status).toBe(200);

    // Verify it's gone
    const listRes = await SELF.fetch(`http://localhost/api/tokens/${tokenId}/packages`, {
      headers: AUTH,
    });
    const body = (await listRes.json()) as Array<unknown>;
    expect(body).toHaveLength(0);
  });

  it("should reject upload without file", async () => {
    const form = new FormData();
    const res = await SELF.fetch(`http://localhost/api/tokens/${tokenId}/packages`, {
      method: "POST",
      headers: AUTH,
      body: form,
    });

    expect(res.status).toBe(400);
  });

  it("should reject non-zip file", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0, 0, 0, 0])], "not-a-zip.txt"));
    const res = await SELF.fetch(`http://localhost/api/tokens/${tokenId}/packages`, {
      method: "POST",
      headers: AUTH,
      body: form,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain("not a valid zip");
  });

  it("should reject zip without composer.json", async () => {
    const zip = zipSync({ "readme.md": new TextEncoder().encode("hello") });
    const res = await uploadPackage(tokenId, zip);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain("No composer.json");
  });

  it("should reject composer.json without name", async () => {
    const zip = createZip({ version: "1.0.0" });
    const res = await uploadPackage(tokenId, zip);

    expect(res.status).toBe(400);
  });

  it("should reject composer.json without version", async () => {
    const zip = createZip({ name: "acme/plugin" });
    const res = await uploadPackage(tokenId, zip);

    expect(res.status).toBe(400);
  });

  it("should reject invalid package name format", async () => {
    const zip = createZip({ name: "invalid-name", version: "1.0.0" });
    const res = await uploadPackage(tokenId, zip);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain("Invalid package name");
  });

  it("should return 404 for non-existent token", async () => {
    const zip = createZip({ name: "acme/plugin", version: "1.0.0" });
    const form = new FormData();
    form.append("file", new File([zip], "package.zip", { type: "application/zip" }));
    const res = await SELF.fetch("http://localhost/api/tokens/99999/packages", {
      method: "POST",
      headers: AUTH,
      body: form,
    });

    expect(res.status).toBe(404);
  });

  it("should overwrite on re-upload of same name+version", async () => {
    const zip1 = createZip({ name: "acme/my-plugin", version: "1.0.0", description: "v1" });
    await uploadPackage(tokenId, zip1);

    const zip2 = createZip({ name: "acme/my-plugin", version: "1.0.0", description: "v2" });
    const res = await uploadPackage(tokenId, zip2);

    expect(res.status).toBe(201);

    const listRes = await SELF.fetch(`http://localhost/api/tokens/${tokenId}/packages`, {
      headers: AUTH,
    });
    const body = (await listRes.json()) as Array<unknown>;
    expect(body).toHaveLength(1);
  });
});

describe("custom packages in Composer API", () => {
  let tokenId: number;
  let tokenValue: string;

  beforeEach(async () => {
    const token = await createToken(`composer-token-${Date.now()}-${Math.random()}`);
    tokenId = token.id;
    tokenValue = token.token;
  });

  it("should include custom packages in packages.json", async () => {
    const zip = createZip({ name: "acme/my-plugin", version: "1.0.0" });
    await uploadPackage(tokenId, zip);

    const res = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: `Bearer ${tokenValue}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { "available-packages": string[] };
    expect(body["available-packages"]).toContain("acme/my-plugin");
  });

  it("should serve custom package metadata via /p2/", async () => {
    const zip = createZip({
      name: "acme/my-plugin",
      version: "1.0.0",
      type: "shopware-platform-plugin",
    });
    await uploadPackage(tokenId, zip);

    const res = await SELF.fetch("http://localhost/p2/acme/my-plugin.json", {
      headers: { Authorization: `Bearer ${tokenValue}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { packages: Record<string, Array<Record<string, unknown>>> };
    expect(body.packages["acme/my-plugin"]).toHaveLength(1);
    expect(body.packages["acme/my-plugin"][0]).toMatchObject({
      name: "acme/my-plugin",
      version: "1.0.0",
    });
  });

  it("should serve custom package download", async () => {
    const zip = createZip({ name: "acme/my-plugin", version: "1.0.0" });
    await uploadPackage(tokenId, zip);

    const res = await SELF.fetch("http://localhost/download/acme/my-plugin/1.0.0", {
      headers: { Authorization: `Bearer ${tokenValue}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    // Consume the body to properly dispose of R2 resources
    await res.arrayBuffer();
  });

  it("should scope custom packages to their token", async () => {
    const zip = createZip({ name: "acme/my-plugin", version: "1.0.0" });
    await uploadPackage(tokenId, zip);

    // Create a second token
    const token2 = await createToken(`other-token-${Date.now()}`);

    // Second token should not see the custom package
    const res = await SELF.fetch("http://localhost/packages.json", {
      headers: { Authorization: `Bearer ${token2.token}` },
    });

    const body = (await res.json()) as { "available-packages": string[] };
    expect(body["available-packages"]).not.toContain("acme/my-plugin");
  });
});
