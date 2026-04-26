/**
 * Tests for JWTAuthenticator (src/auth/jwt.ts).
 */

import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { JWTAuthenticator } from "../../src/auth/jwt.js";
import type { IncomingMessage } from "node:http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-secret-key-for-jwt";

function makeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function signToken(
  payload: Record<string, unknown>,
  secret: string = SECRET,
  options?: jwt.SignOptions,
): string {
  return jwt.sign(payload, secret, { algorithm: "HS256", ...options });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JWTAuthenticator", () => {
  // ── Valid tokens ──────────────────────────────────────────────────────

  it("returns Identity for valid token with sub claim", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const token = signToken({ sub: "user-123", type: "admin", roles: ["editor", "viewer"] });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);

    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("user-123");
    expect(identity!.type).toBe("admin");
    expect(identity!.roles).toEqual(["editor", "viewer"]);
  });

  it("defaults type to 'user' when not in claims", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const token = signToken({ sub: "user-456" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);

    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("user-456");
    expect(identity!.type).toBe("user");
    expect(identity!.roles).toEqual([]);
  });

  it("returns null when sub is missing (matches Python behavior)", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET, requireClaims: [] });
    const token = signToken({ custom_field: "value" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);

    expect(identity).toBeNull();
  });

  // ── Custom claim mapping ──────────────────────────────────────────────

  it("uses custom claim mapping", async () => {
    const auth = new JWTAuthenticator({
      secret: SECRET,
      claimMapping: {
        id: "user_id",
        type: "user_type",
        roles: "permissions",
      },
      requireClaims: [],
    });
    const token = signToken({
      user_id: "custom-789",
      user_type: "service",
      permissions: ["read", "write"],
    });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);

    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("custom-789");
    expect(identity!.type).toBe("service");
    expect(identity!.roles).toEqual(["read", "write"]);
  });

  it("handles partial claim mapping (uses defaults for unset)", async () => {
    const auth = new JWTAuthenticator({
      secret: SECRET,
      claimMapping: { id: "uid" },
      requireClaims: [],
    });
    const token = signToken({ uid: "partial-user", type: "bot", roles: ["admin"] });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);

    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("partial-user");
    expect(identity!.type).toBe("bot");
    expect(identity!.roles).toEqual(["admin"]);
  });

  // ── Audience and issuer validation ────────────────────────────────────

  it("accepts token with matching audience", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET, audience: "my-app" });
    const token = signToken({ sub: "user-1" }, SECRET, { audience: "my-app" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("user-1");
  });

  it("rejects token with wrong audience", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET, audience: "my-app" });
    const token = signToken({ sub: "user-1" }, SECRET, { audience: "other-app" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("accepts token with matching issuer", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET, issuer: "auth-service" });
    const token = signToken({ sub: "user-1" }, SECRET, { issuer: "auth-service" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("user-1");
  });

  it("rejects token with wrong issuer", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET, issuer: "auth-service" });
    const token = signToken({ sub: "user-1" }, SECRET, { issuer: "wrong-issuer" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  // ── Invalid/missing tokens ────────────────────────────────────────────

  it("returns null when no Authorization header", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const req = makeReq({});

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("returns null for non-Bearer scheme", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const req = makeReq({ authorization: "Basic dXNlcjpwYXNz" });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("returns null for malformed Bearer header (no token)", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const req = makeReq({ authorization: "Bearer" });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("returns null for malformed Bearer header (extra parts)", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const req = makeReq({ authorization: "Bearer token extra" });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("returns null for expired token", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    // [JWT-3] Authenticator now applies 30s clock-skew leeway. Use a
    // token expired 60s ago so it's past the leeway window.
    const token = signToken({ sub: "user-1" }, SECRET, { expiresIn: -60 });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("returns null for invalid signature (wrong secret)", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const token = signToken({ sub: "user-1" }, "wrong-secret");
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("returns null for completely invalid token string", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const req = makeReq({ authorization: "Bearer not.a.valid.jwt" });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  // ── Roles handling ────────────────────────────────────────────────────

  it("returns empty roles when roles claim is not an array", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const token = signToken({ sub: "user-1", roles: "admin" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.roles).toEqual([]);
  });

  it("converts numeric roles to strings", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const token = signToken({ sub: "user-1", roles: [1, 2, 3] });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.roles).toEqual(["1", "2", "3"]);
  });

  // ── Case insensitivity ────────────────────────────────────────────────

  it("handles case-insensitive 'bearer' prefix", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const token = signToken({ sub: "user-1" });
    const req = makeReq({ authorization: `BEARER ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("user-1");
  });

  // ── attrs claim extraction ──────────────────────────────────────────

  it("extracts attrs from payload using claimMapping.attrs", async () => {
    const auth = new JWTAuthenticator({
      secret: SECRET,
      claimMapping: { attrs: ["email", "org"] },
    });
    const token = signToken({ sub: "user-1", email: "a@b.com", org: "acme" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.attrs).toEqual({ email: "a@b.com", org: "acme" });
  });

  it("skips missing attrs claims", async () => {
    const auth = new JWTAuthenticator({
      secret: SECRET,
      claimMapping: { attrs: ["email", "missing_claim"] },
    });
    const token = signToken({ sub: "user-1", email: "a@b.com" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.attrs).toEqual({ email: "a@b.com" });
  });

  it("returns empty attrs when no attrs mapping configured", async () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    const token = signToken({ sub: "user-1", email: "a@b.com" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.attrs).toEqual({});
  });

  // ── requireClaims validation ────────────────────────────────────────

  it("returns null when required claim is missing", async () => {
    const auth = new JWTAuthenticator({
      secret: SECRET,
      requireClaims: ["sub", "email"],
    });
    const token = signToken({ sub: "user-1" }); // missing "email"
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  it("returns identity when all required claims are present", async () => {
    const auth = new JWTAuthenticator({
      secret: SECRET,
      requireClaims: ["sub", "email"],
    });
    const token = signToken({ sub: "user-1", email: "a@b.com" });
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).not.toBeNull();
    expect(identity!.id).toBe("user-1");
  });

  it("returns null when requireClaims is empty and id claim is missing", async () => {
    const auth = new JWTAuthenticator({
      secret: SECRET,
      requireClaims: [],
    });
    const token = signToken({ custom: "value" }); // no sub claim
    const req = makeReq({ authorization: `Bearer ${token}` });

    const identity = await auth.authenticate(req);
    expect(identity).toBeNull();
  });

  // ── requireAuth getter ──────────────────────────────────────────────

  it("requireAuth defaults to true", () => {
    const auth = new JWTAuthenticator({ secret: SECRET });
    expect(auth.requireAuth).toBe(true);
  });

  it("requireAuth reflects constructor option", () => {
    const auth = new JWTAuthenticator({ secret: SECRET, requireAuth: false });
    expect(auth.requireAuth).toBe(false);
  });
});
