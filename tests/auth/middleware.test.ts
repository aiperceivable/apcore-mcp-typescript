/**
 * Tests for createAuthMiddleware (A-D-230).
 *
 * Mirrors the behavioral contract enforced by Python's
 * `tests/auth/test_middleware.py` and Rust's
 * `tests/auth_middleware_test.rs`:
 *   - 401 + WWW-Authenticate on missing/invalid token
 *   - exempt paths and prefixes bypass auth
 *   - permissive mode forwards without identity
 *   - identity scoped via AsyncLocalStorage so getCurrentIdentity() resolves
 */

import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createAuthMiddleware,
  DEFAULT_EXEMPT_PATHS,
} from "../../src/auth/middleware.js";
import { getCurrentIdentity } from "../../src/auth/storage.js";
import type { Authenticator, Identity } from "../../src/auth/types.js";

// ---------------------------------------------------------------------------
// Helpers — minimal req/res stubs sufficient for the middleware contract.
// ---------------------------------------------------------------------------

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

function makeReq(
  url: string,
  headers: Record<string, string | string[] | undefined> = {},
): IncomingMessage {
  return { url, headers } as unknown as IncomingMessage;
}

function makeRes(): FakeResponse & ServerResponse {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: "",
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk !== undefined) this.body += chunk;
      this.ended = true;
    },
  };
  return res as unknown as FakeResponse & ServerResponse;
}

function makeAuthenticator(
  result: Identity | null,
): Authenticator & { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn().mockResolvedValue(result);
  return { authenticate: mock, mock };
}

const SAMPLE_IDENTITY: Identity = {
  // Identity from apcore-js — the middleware does not introspect any field;
  // a structurally valid stub is enough for these tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as Identity;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAuthMiddleware [A-D-230]", () => {
  it("returns 401 with structured envelope when no Authorization header", async () => {
    const auth = makeAuthenticator(null);
    const mw = createAuthMiddleware({ authenticator: auth });
    const next = vi.fn();
    const res = makeRes();

    await mw(makeReq("/mcp"), res, next);

    expect((res as unknown as FakeResponse).statusCode).toBe(401);
    expect((res as unknown as FakeResponse).headers["content-type"]).toBe(
      "application/json",
    );
    expect((res as unknown as FakeResponse).headers["www-authenticate"]).toBe(
      "Bearer",
    );
    const body = JSON.parse((res as unknown as FakeResponse).body);
    expect(body).toEqual({
      error: "Unauthorized",
      detail: "Missing or invalid Bearer token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when authenticator rejects an invalid token", async () => {
    const auth = makeAuthenticator(null);
    const mw = createAuthMiddleware({ authenticator: auth });
    const next = vi.fn();
    const res = makeRes();

    await mw(
      makeReq("/mcp", { authorization: "Bearer broken.jwt.token" }),
      res,
      next,
    );

    expect((res as unknown as FakeResponse).statusCode).toBe(401);
    expect(auth.mock).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() with identity scoped via identityStorage when token valid", async () => {
    const auth = makeAuthenticator(SAMPLE_IDENTITY);
    const mw = createAuthMiddleware({ authenticator: auth });

    let observedIdentity: Identity | null = null;
    const next = vi.fn(async () => {
      observedIdentity = getCurrentIdentity();
    });

    const res = makeRes();
    await mw(
      makeReq("/mcp", { authorization: "Bearer good.jwt" }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(observedIdentity).toBe(SAMPLE_IDENTITY);
    expect((res as unknown as FakeResponse).statusCode).toBe(200);
  });

  // [D11-1] Exempt paths still invoke the authenticator (best-effort) so
  // identity is hydrated when a valid token is present, but never reject the
  // request on failure.
  it("forwards exempt path /health without 401 even when auth fails", async () => {
    const auth = makeAuthenticator(null);
    const mw = createAuthMiddleware({ authenticator: auth });
    const next = vi.fn();
    const res = makeRes();

    await mw(makeReq("/health"), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((res as unknown as FakeResponse).statusCode).toBe(200);
  });

  it("forwards exempt prefix without 401 even when auth fails", async () => {
    const auth = makeAuthenticator(null);
    const mw = createAuthMiddleware({
      authenticator: auth,
      exemptPrefixes: new Set(["/explorer"]),
    });
    const next = vi.fn();
    const res = makeRes();

    await mw(makeReq("/explorer/dashboard?tab=tools"), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("strips query string before exempt-path matching", async () => {
    const auth = makeAuthenticator(null);
    const mw = createAuthMiddleware({ authenticator: auth });
    const next = vi.fn();
    const res = makeRes();

    await mw(makeReq("/health?probe=1"), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((res as unknown as FakeResponse).statusCode).toBe(200);
  });

  it("permissive mode (requireAuth: false) forwards without identity on auth fail", async () => {
    const auth = makeAuthenticator(null);
    const mw = createAuthMiddleware({
      authenticator: auth,
      requireAuth: false,
    });

    let observedIdentity: Identity | null | undefined = undefined;
    const next = vi.fn(() => {
      observedIdentity = getCurrentIdentity();
    });

    const res = makeRes();
    await mw(makeReq("/mcp"), res, next);

    expect(auth.mock).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect((res as unknown as FakeResponse).statusCode).toBe(200);
    expect(observedIdentity).toBeNull();
  });

  it("flattens multi-value headers and lowercases names", async () => {
    const auth = makeAuthenticator(SAMPLE_IDENTITY);
    const mw = createAuthMiddleware({ authenticator: auth });
    const next = vi.fn();
    const res = makeRes();

    await mw(
      makeReq("/mcp", {
        Authorization: "Bearer tok",
        "X-Forwarded-For": ["1.2.3.4", "5.6.7.8"],
      }),
      res,
      next,
    );

    const headersPassed = auth.mock.mock.calls[0][0] as Record<string, string>;
    expect(headersPassed["authorization"]).toBe("Bearer tok");
    expect(headersPassed["x-forwarded-for"]).toBe("1.2.3.4, 5.6.7.8");
  });

  it("DEFAULT_EXEMPT_PATHS matches transport.ts defaults", () => {
    expect(new Set(DEFAULT_EXEMPT_PATHS)).toEqual(
      new Set(["/health", "/metrics", "/usage"]),
    );
  });

  // [D11-1] Cross-language parity: Python/Rust still call the authenticator
  // on exempt paths in best-effort mode so getCurrentIdentity() resolves when
  // a valid token is present. TS used to short-circuit before authenticating,
  // leaving downstream handlers without identity context on /health etc.
  it("hydrates identity on exempt paths when a valid token is present", async () => {
    const auth = makeAuthenticator(SAMPLE_IDENTITY);
    const mw = createAuthMiddleware({ authenticator: auth });

    let observed: Identity | null = null;
    const next = vi.fn(() => {
      observed = getCurrentIdentity();
    });

    const res = makeRes();
    await mw(
      makeReq("/health", { authorization: "Bearer good.jwt" }),
      res,
      next,
    );

    expect(auth.mock).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(observed).toBe(SAMPLE_IDENTITY);
    // Exempt path must not 401 even if auth had failed — this is best-effort.
    expect((res as unknown as FakeResponse).statusCode).toBe(200);
  });

  it("exempt path remains accessible when authenticator fails (best-effort)", async () => {
    const auth = makeAuthenticator(null);
    const mw = createAuthMiddleware({ authenticator: auth });

    let observed: Identity | null = null;
    const next = vi.fn(() => {
      observed = getCurrentIdentity();
    });

    const res = makeRes();
    await mw(
      makeReq("/health", { authorization: "Bearer broken.jwt" }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(observed).toBeNull();
    expect((res as unknown as FakeResponse).statusCode).toBe(200);
  });

  it("exempt path still forwards even if authenticator throws", async () => {
    const auth: Authenticator = {
      authenticate: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const mw = createAuthMiddleware({ authenticator: auth });
    const next = vi.fn();
    const res = makeRes();

    await mw(
      makeReq("/health", { authorization: "Bearer x" }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect((res as unknown as FakeResponse).statusCode).toBe(200);
  });
});
