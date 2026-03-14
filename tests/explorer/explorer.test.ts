/**
 * Tests for the MCP Tool Explorer (TC-EXPLORER spec).
 *
 * Uses mcp-embedded-ui's createNodeHandler as the explorer backend.
 *
 * TC-001: Explorer page returns HTML
 * TC-002: Explorer disabled by default (endpoints 404 when not mounted)
 * TC-003: Tool listing returns JSON array
 * TC-004: Tool detail + 404 for unknown
 * TC-005: Tool execution
 * TC-006: Execute disabled (403)
 * TC-007: Explorer ignored for stdio
 * TC-008: Custom prefix
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createNodeHandler, type Tool as UITool } from "mcp-embedded-ui";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ExecutionRouter } from "../../src/server/router.js";
import type { TextContentDict } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mock Tools
// ---------------------------------------------------------------------------

const sampleTools: Tool[] = [
  {
    name: "image.resize",
    description: "Resize an image",
    inputSchema: {
      type: "object" as const,
      properties: {
        width: { type: "integer" },
        height: { type: "integer" },
      },
      required: ["width", "height"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "text.echo",
    description: "Echo input text",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Mock Router
// ---------------------------------------------------------------------------

function createMockRouter(
  overrides?: Partial<ExecutionRouter>,
): ExecutionRouter {
  return {
    handleCall: vi.fn().mockResolvedValue([
      [{ type: "text", text: '{"result": "ok"}' }] as TextContentDict[],
      false,
      "trace-123",
    ]),
    ...overrides,
  } as unknown as ExecutionRouter;
}

// ---------------------------------------------------------------------------
// Helper: create HTTP server with explorer handler and send requests
// ---------------------------------------------------------------------------

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

interface TestServer {
  server: HttpServer;
  port: number;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

function buildExplorerHandler(
  router: ExecutionRouter,
  options: { prefix?: string; allowExecute?: boolean } = {},
): NodeHandler {
  const prefix = options.prefix ?? "/explorer";
  return createNodeHandler(
    sampleTools as UITool[],
    async (name: string, args: Record<string, unknown>) => router.handleCall(name, args),
    { prefix, allowExecute: options.allowExecute ?? false },
  );
}

async function createTestServer(
  handler: NodeHandler | null,
  prefix = "/explorer",
): Promise<TestServer> {
  const httpServer = createServer(async (req, res) => {
    if (handler) {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) {
        handler(req, res);
        return;
      }
    }
    res.writeHead(404).end("Not Found");
  });

  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      resolve({
        server: httpServer,
        port,
        fetch: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init),
        close: () =>
          new Promise<void>((r) => httpServer.close(() => r())),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// TC-001: GET /explorer/ returns HTML 200 with self-contained page
// ---------------------------------------------------------------------------

describe("TC-001: Explorer page returns HTML", () => {
  let ts: TestServer;

  beforeAll(async () => {
    const router = createMockRouter();
    const handler = buildExplorerHandler(router, { allowExecute: true });
    ts = await createTestServer(handler);
  });

  afterAll(async () => {
    await ts.close();
  });

  it("returns HTML with 200 status", async () => {
    const res = await ts.fetch("/explorer/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("MCP Tool Explorer");
  });

  it("returns self-contained page with style and script", async () => {
    const res = await ts.fetch("/explorer/");
    const text = await res.text();
    expect(text).toContain("<style>");
    expect(text).toContain("<script>");
  });

  it("also works without trailing slash", async () => {
    const res = await ts.fetch("/explorer");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("MCP Tool Explorer");
  });
});

// ---------------------------------------------------------------------------
// TC-002: Explorer disabled by default (endpoints 404 when not mounted)
// ---------------------------------------------------------------------------

describe("TC-002: Explorer disabled by default", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await createTestServer(null);
  });

  afterAll(async () => {
    await ts.close();
  });

  it("returns 404 when explorer is not mounted", async () => {
    const res = await ts.fetch("/explorer/");
    expect(res.status).toBe(404);
  });

  it("returns 404 for /explorer/tools when not mounted", async () => {
    const res = await ts.fetch("/explorer/tools");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// TC-003: GET /explorer/tools returns JSON array with correct fields
// ---------------------------------------------------------------------------

describe("TC-003: List tools", () => {
  let ts: TestServer;

  beforeAll(async () => {
    const router = createMockRouter();
    const handler = buildExplorerHandler(router, { allowExecute: true });
    ts = await createTestServer(handler);
  });

  afterAll(async () => {
    await ts.close();
  });

  it("returns JSON array", async () => {
    const res = await ts.fetch("/explorer/tools");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
  });

  it("has correct fields", async () => {
    const res = await ts.fetch("/explorer/tools");
    const data = await res.json();
    const tool = data[0];
    expect(tool).toHaveProperty("name", "image.resize");
    expect(tool).toHaveProperty("description", "Resize an image");
  });

  it("includes annotations", async () => {
    const res = await ts.fetch("/explorer/tools");
    const data = await res.json();
    const tool = data[0];
    expect(tool).toHaveProperty("annotations");
    expect(tool.annotations.idempotentHint).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-004: GET /explorer/tools/<name> returns detail + 404 for unknown
// ---------------------------------------------------------------------------

describe("TC-004: Tool detail", () => {
  let ts: TestServer;

  beforeAll(async () => {
    const router = createMockRouter();
    const handler = buildExplorerHandler(router, { allowExecute: true });
    ts = await createTestServer(handler);
  });

  afterAll(async () => {
    await ts.close();
  });

  it("returns full tool info", async () => {
    const res = await ts.fetch("/explorer/tools/image.resize");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("image.resize");
    expect(data.description).toBe("Resize an image");
    expect(data).toHaveProperty("inputSchema");
    expect(data.inputSchema).toHaveProperty("properties");
  });

  it("includes annotations in detail", async () => {
    const res = await ts.fetch("/explorer/tools/image.resize");
    const data = await res.json();
    expect(data).toHaveProperty("annotations");
    expect(data.annotations.idempotentHint).toBe(true);
  });

  it("returns 404 for unknown tool", async () => {
    const res = await ts.fetch("/explorer/tools/nonexistent.tool");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// TC-005: POST /explorer/tools/<name>/call executes tool
// ---------------------------------------------------------------------------

describe("TC-005: Call tool", () => {
  let ts: TestServer;
  let mockRouter: ExecutionRouter;

  beforeAll(async () => {
    mockRouter = createMockRouter();
    const handler = buildExplorerHandler(mockRouter, { allowExecute: true });
    ts = await createTestServer(handler);
  });

  afterAll(async () => {
    await ts.close();
  });

  it("executes tool and returns MCP-compliant CallToolResult", async () => {
    const res = await ts.fetch("/explorer/tools/image.resize/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 100, height: 200 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // MCP-compliant format: {content, isError, _meta}
    expect(data).toHaveProperty("content");
    expect(data).toHaveProperty("isError", false);
    expect(data).toHaveProperty("_meta");
    expect(data._meta).toHaveProperty("_trace_id", "trace-123");
    expect(
      (mockRouter.handleCall as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith("image.resize", { width: 100, height: 200 });
  });

  it("returns 404 for unknown tool", async () => {
    const res = await ts.fetch("/explorer/tools/nonexistent.tool/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("returns 500 on execution error with MCP-compliant format", async () => {
    (mockRouter.handleCall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ type: "text", text: "Module not found" }],
      true,
      undefined,
    ]);
    const res = await ts.fetch("/explorer/tools/image.resize/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data).toHaveProperty("content");
    expect(data).toHaveProperty("isError", true);
  });
});

// ---------------------------------------------------------------------------
// TC-006: Call returns 403 when allowExecute=false
// ---------------------------------------------------------------------------

describe("TC-006: Execute disabled", () => {
  let ts: TestServer;

  beforeAll(async () => {
    const router = createMockRouter();
    const handler = buildExplorerHandler(router, { allowExecute: false });
    ts = await createTestServer(handler);
  });

  afterAll(async () => {
    await ts.close();
  });

  it("returns 403 when execution is disabled", async () => {
    const res = await ts.fetch("/explorer/tools/image.resize/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 100, height: 200 }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data).toHaveProperty("error");
    const error = data.error.toLowerCase();
    expect(error.includes("disabled") || error.includes("execution")).toBe(
      true,
    );
  });

  it("list and detail still work when execute disabled", async () => {
    const listRes = await ts.fetch("/explorer/tools");
    expect(listRes.status).toBe(200);
    const detailRes = await ts.fetch("/explorer/tools/image.resize");
    expect(detailRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// TC-007: Explorer ignored for stdio (no error)
// ---------------------------------------------------------------------------

describe("TC-007: Stdio ignored", () => {
  it("createNodeHandler can be called without error", () => {
    const tools = [
      {
        name: "test.tool",
        description: "Test",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ];
    const handler = createNodeHandler(
      tools,
      async () => [[{ type: "text" as const, text: "ok" }], false],
    );
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// TC-008: Custom explorer_prefix mounts correctly
// ---------------------------------------------------------------------------

describe("TC-008: Custom prefix", () => {
  let ts: TestServer;

  beforeAll(async () => {
    const router = createMockRouter();
    const handler = buildExplorerHandler(router, {
      prefix: "/custom",
      allowExecute: true,
    });
    ts = await createTestServer(handler, "/custom");
  });

  afterAll(async () => {
    await ts.close();
  });

  it("serves at custom prefix", async () => {
    const res = await ts.fetch("/custom/");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("MCP Tool Explorer");
  });

  it("tools endpoint works at custom prefix", async () => {
    const res = await ts.fetch("/custom/tools");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("default prefix returns 404 with custom prefix", async () => {
    const res = await ts.fetch("/explorer/");
    expect(res.status).toBe(404);
  });
});
