import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("tokens API", () => {
  it("should create a token", async () => {
    const res = await SELF.fetch("http://localhost/api/tokens", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-api-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: "my-shop-token" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.any(Number),
      token: "my-shop-token",
    });
  });

  it("should list tokens", async () => {
    const res = await SELF.fetch("http://localhost/api/tokens", {
      headers: { Authorization: "Bearer test-api-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("should reject unauthenticated requests", async () => {
    const res = await SELF.fetch("http://localhost/api/tokens");
    expect(res.status).toBe(401);
  });
});
