/**
 * Integration tests for auth + transport + explorer.
 *
 * Tests that authenticated requests flow through to the MCP endpoint,
 * unauthenticated requests are rejected, and exempt routes bypass auth.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AddressInfo } from "node:net";
import { TransportManager } from "../../src/server/transport.js";
import { JWTAuthenticator } from "../../src/auth/jwt.js";
import { ExplorerHandler } from "../../src/explorer/handler.js";
import type { ExecutionRouter } from "../../src/server/router.js";
import type { TextContentDict } from "../../src/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "integration-test-secret";

function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, SECRET, { algorithm: "HS256" });
}

function createMockServer(): Server {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as Server;
}

function createMockRouter(): ExecutionRouter {
  return {
    handleCall: vi.fn().mockResolvedValue([
      [{ type: "text", text: '{"result":"ok"}' }] as TextContentDict[],
      false,
      "trace-int",
    ]),
  } as unknown as ExecutionRouter;
}

const sampleTools: Tool[] = [
  {
    name: "test.tool",
    description: "Test tool",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Transport + Auth Integration
// ---------------------------------------------------------------------------

describe("Transport auth integration (streamable-http)", () => {
  let mgr: TransportManager;

  afterEach(async () => {
    if (mgr) await mgr.close();
  });

  it("/health is exempt from auth", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("/metrics is exempt from auth", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    mgr.setMetricsCollector({ exportPrometheus: () => "# no metrics" });
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(200);
  });

  it("POST /mcp returns 401 without token", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication required");
  });

  it("POST /mcp proceeds with valid token", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const token = signToken({ sub: "user-1" });
    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    // Should reach the transport handler (not our 401)
    expect(res.status).not.toBe(401);
  });

  it("returns 401 for invalid token", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid.token.here",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("no auth required when no authenticator is set", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).not.toBe(401);
  });
});

describe("Transport auth integration (sse)", () => {
  let mgr: TransportManager;

  afterEach(async () => {
    if (mgr) await mgr.close();
  });

  it("/health is exempt from auth in SSE mode", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runSse(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(res.status).toBe(200);
  });

  it("POST /messages returns 401 without token in SSE mode", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runSse(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/messages?sessionId=abc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Explorer + Auth Integration
// ---------------------------------------------------------------------------

describe("Explorer auth integration", () => {
  let mgr: TransportManager;

  afterEach(async () => {
    if (mgr) await mgr.close();
  });

  it("GET /explorer/ is exempt from auth", async () => {
    mgr = new TransportManager();
    const authenticator = new JWTAuthenticator({ secret: SECRET });
    mgr.setAuthenticator(authenticator);
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
      authenticator,
    });
    mgr.setExplorerHandler(handler);

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/explorer/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("MCP Tool Explorer");
  });

  it("GET /explorer/tools is exempt from auth", async () => {
    mgr = new TransportManager();
    const authenticator = new JWTAuthenticator({ secret: SECRET });
    mgr.setAuthenticator(authenticator);
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
      authenticator,
    });
    mgr.setExplorerHandler(handler);

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/explorer/tools`);
    expect(res.status).toBe(200);
  });

  it("POST /explorer/tools/{name}/call returns 401 without token when authenticator set", async () => {
    mgr = new TransportManager();
    const authenticator = new JWTAuthenticator({ secret: SECRET });
    mgr.setAuthenticator(authenticator);
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
      authenticator,
    });
    mgr.setExplorerHandler(handler);

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/explorer/tools/test.tool/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication required");
  });

  it("POST /explorer/tools/{name}/call succeeds with valid token", async () => {
    mgr = new TransportManager();
    const authenticator = new JWTAuthenticator({ secret: SECRET });
    mgr.setAuthenticator(authenticator);
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
      authenticator,
    });
    mgr.setExplorerHandler(handler);

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const token = signToken({ sub: "explorer-user" });
    const res = await fetch(`http://127.0.0.1:${addr.port}/explorer/tools/test.tool/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isError).toBe(false);
  });

  it("TC-AUTH-INT-018: Explorer GET routes are exempt even with custom exempt_paths", async () => {
    mgr = new TransportManager();
    const authenticator = new JWTAuthenticator({ secret: SECRET });
    mgr.setAuthenticator(authenticator);
    // Set custom exempt paths that do NOT include /explorer
    mgr.setExemptPaths(["/health", "/status"]);
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
      authenticator,
    });
    mgr.setExplorerHandler(handler);

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    // Explorer GET routes should still be exempt because of the explorer handler logic
    const htmlRes = await fetch(`http://127.0.0.1:${addr.port}/explorer/`);
    expect(htmlRes.status).toBe(200);
    const text = await htmlRes.text();
    expect(text).toContain("MCP Tool Explorer");

    const toolsRes = await fetch(`http://127.0.0.1:${addr.port}/explorer/tools`);
    expect(toolsRes.status).toBe(200);

    const toolDetailRes = await fetch(`http://127.0.0.1:${addr.port}/explorer/tools/test.tool`);
    expect(toolDetailRes.status).toBe(200);

    // /status is in custom exempt paths, so GET /status should bypass auth
    // (returns 404 because no handler, but NOT 401)
    const statusRes = await fetch(`http://127.0.0.1:${addr.port}/status`);
    expect(statusRes.status).not.toBe(401);

    // POST /mcp should still require auth (not exempt)
    const mcpRes = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(mcpRes.status).toBe(401);
  });

  it("explorer call works without authenticator (no auth required)", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
    });
    mgr.setExplorerHandler(handler);

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/explorer/tools/test.tool/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// _isAuthExempt tests
// ---------------------------------------------------------------------------

describe("TransportManager._isAuthExempt", () => {
  it("exempts GET /health", () => {
    const mgr = new TransportManager();
    expect(mgr._isAuthExempt("/health", "GET")).toBe(true);
  });

  it("does not exempt POST /health", () => {
    const mgr = new TransportManager();
    expect(mgr._isAuthExempt("/health", "POST")).toBe(false);
  });

  it("exempts GET /metrics", () => {
    const mgr = new TransportManager();
    expect(mgr._isAuthExempt("/metrics", "GET")).toBe(true);
  });

  it("does not exempt /mcp", () => {
    const mgr = new TransportManager();
    expect(mgr._isAuthExempt("/mcp", "POST")).toBe(false);
  });

  it("exempts GET /explorer/ when explorer handler is set", () => {
    const mgr = new TransportManager();
    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router);
    mgr.setExplorerHandler(handler);

    expect(mgr._isAuthExempt("/explorer/", "GET")).toBe(true);
    expect(mgr._isAuthExempt("/explorer/tools", "GET")).toBe(true);
    expect(mgr._isAuthExempt("/explorer", "GET")).toBe(true);
  });

  it("does not exempt explorer GET when no handler is set", () => {
    const mgr = new TransportManager();
    expect(mgr._isAuthExempt("/explorer/", "GET")).toBe(false);
  });

  it("uses custom exempt paths", () => {
    const mgr = new TransportManager();
    mgr.setExemptPaths(["/health", "/status", "/ready"]);

    expect(mgr._isAuthExempt("/health", "GET")).toBe(true);
    expect(mgr._isAuthExempt("/status", "GET")).toBe(true);
    expect(mgr._isAuthExempt("/ready", "GET")).toBe(true);
    expect(mgr._isAuthExempt("/metrics", "GET")).toBe(false); // removed from defaults
  });
});

// ---------------------------------------------------------------------------
// Permissive mode (requireAuth=false)
// ---------------------------------------------------------------------------

describe("Permissive mode (requireAuth=false)", () => {
  let mgr: TransportManager;

  afterEach(async () => {
    if (mgr) await mgr.close();
  });

  it("allows requests without token when requireAuth=false", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET, requireAuth: false }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    // Should NOT get 401 — permissive mode allows through
    expect(res.status).not.toBe(401);
  });

  it("still authenticates with valid token in permissive mode", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET, requireAuth: false }));
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    const token = signToken({ sub: "user-1" });
    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Custom exempt paths integration
// ---------------------------------------------------------------------------

describe("Custom exempt paths integration", () => {
  let mgr: TransportManager;

  afterEach(async () => {
    if (mgr) await mgr.close();
  });

  it("custom exempt path bypasses auth", async () => {
    mgr = new TransportManager();
    mgr.setAuthenticator(new JWTAuthenticator({ secret: SECRET }));
    mgr.setExemptPaths(["/health", "/metrics", "/status"]);
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(createMockServer(), { host: "127.0.0.1", port: 0 });
    const addr = mgr.httpServer!.address() as AddressInfo;

    // /health still exempt
    const healthRes = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(healthRes.status).toBe(200);
  });
});
