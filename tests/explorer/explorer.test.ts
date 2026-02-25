/**
 * Tests for the MCP Tool Explorer (TC-EXPLORER spec).
 *
 * Mirrors the Python test suite for consistency:
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
import { createServer, type Server as HttpServer } from "node:http";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ExplorerHandler } from "../../src/explorer/handler.js";
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
    ]),
    ...overrides,
  } as unknown as ExecutionRouter;
}

// ---------------------------------------------------------------------------
// Helper: create HTTP server with ExplorerHandler and send requests
// ---------------------------------------------------------------------------

interface TestServer {
  server: HttpServer;
  port: number;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

async function createTestServer(
  handler: ExplorerHandler | null,
): Promise<TestServer> {
  const httpServer = createServer(async (req, res) => {
    if (handler) {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      try {
        const handled = await handler.handleRequest(req, res, url);
        if (handled) return;
      } catch {
        if (!res.headersSent) {
          res.writeHead(500).end("Internal Server Error");
        }
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
  let router: ExecutionRouter;

  beforeAll(async () => {
    router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
    });
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
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
    });
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
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: true,
    });
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
    const handler = new ExplorerHandler(sampleTools, mockRouter, {
      allowExecute: true,
    });
    ts = await createTestServer(handler);
  });

  afterAll(async () => {
    await ts.close();
  });

  it("executes tool and returns result", async () => {
    const res = await ts.fetch("/explorer/tools/image.resize/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 100, height: 200 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("result");
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

  it("returns 500 on execution error", async () => {
    (mockRouter.handleCall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ type: "text", text: "Module not found" }],
      true,
    ]);
    const res = await ts.fetch("/explorer/tools/image.resize/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// TC-006: Call returns 403 when allowExecute=false
// ---------------------------------------------------------------------------

describe("TC-006: Execute disabled", () => {
  let ts: TestServer;

  beforeAll(async () => {
    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      allowExecute: false,
    });
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
    expect(error.includes("disabled") || error.includes("allow-execute")).toBe(
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
  it("ExplorerHandler can be created without error", () => {
    const tools: Tool[] = [
      {
        name: "test.tool",
        description: "Test",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ];
    const router = createMockRouter();
    const handler = new ExplorerHandler(tools, router);
    expect(handler).toBeDefined();
    expect(handler.prefix).toBe("/explorer");
  });
});

// ---------------------------------------------------------------------------
// TC-008: Custom explorer_prefix mounts correctly
// ---------------------------------------------------------------------------

describe("TC-008: Custom prefix", () => {
  let ts: TestServer;

  beforeAll(async () => {
    const router = createMockRouter();
    const handler = new ExplorerHandler(sampleTools, router, {
      prefix: "/custom",
      allowExecute: true,
    });
    ts = await createTestServer(handler);
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
