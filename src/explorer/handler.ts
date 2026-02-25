/**
 * ExplorerHandler - HTTP route handler for the MCP Tool Explorer.
 *
 * Provides a browser-based UI for inspecting and testing MCP tools.
 * Handles explorer-prefixed HTTP routes within the existing HTTP server.
 *
 * Routes:
 * - GET  {prefix}/         → HTML explorer page
 * - GET  {prefix}/tools    → JSON array of tool summaries
 * - GET  {prefix}/tools/{name}      → JSON tool detail
 * - POST {prefix}/tools/{name}/call → Execute tool (403 if disabled)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ExecutionRouter } from "../server/router.js";
import { readBody } from "../server/transport.js";
import { EXPLORER_HTML } from "./html.js";

/** Options for creating an ExplorerHandler. */
export interface ExplorerHandlerOptions {
  /** Whether to allow tool execution from the explorer UI. Default: false */
  allowExecute?: boolean;
  /** URL prefix for the explorer. Default: "/explorer" */
  prefix?: string;
}

/** Maximum request body size for explorer call endpoint (1MB). */
const EXPLORER_MAX_BODY_BYTES = 1024 * 1024;

export class ExplorerHandler {
  private readonly _toolsByName: Map<string, Tool>;
  private readonly _tools: Tool[];
  private readonly _router: ExecutionRouter;
  private readonly _allowExecute: boolean;
  private readonly _prefix: string;

  constructor(
    tools: Tool[],
    router: ExecutionRouter,
    options?: ExplorerHandlerOptions,
  ) {
    this._tools = tools;
    this._router = router;
    this._allowExecute = options?.allowExecute ?? false;
    this._prefix = options?.prefix ?? "/explorer";
    this._toolsByName = new Map(tools.map((t) => [t.name, t]));
  }

  /** The URL prefix this handler is mounted at. */
  get prefix(): string {
    return this._prefix;
  }

  /**
   * Attempt to handle an HTTP request.
   *
   * @returns true if the request was handled, false if it should be passed through
   */
  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const pathname = url.pathname;

    // Normalize: strip trailing slash for matching (except root)
    const prefixSlash = this._prefix + "/";

    // GET {prefix}/ → HTML page
    if (
      req.method === "GET" &&
      (pathname === this._prefix || pathname === prefixSlash)
    ) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(EXPLORER_HTML);
      return true;
    }

    // GET {prefix}/tools → list all tools
    if (req.method === "GET" && pathname === this._prefix + "/tools") {
      const summaries = this._tools.map((t) => this._toolSummary(t));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summaries));
      return true;
    }

    // POST {prefix}/tools/{name}/call → execute tool
    if (req.method === "POST" && pathname.startsWith(this._prefix + "/tools/") && pathname.endsWith("/call")) {
      const toolName = decodeURIComponent(
        pathname.slice((this._prefix + "/tools/").length, -"/call".length),
      );
      await this._handleCallTool(req, res, toolName);
      return true;
    }

    // GET {prefix}/tools/{name} → tool detail
    if (req.method === "GET" && pathname.startsWith(this._prefix + "/tools/")) {
      const toolName = decodeURIComponent(
        pathname.slice((this._prefix + "/tools/").length),
      );
      this._handleToolDetail(res, toolName);
      return true;
    }

    return false;
  }

  /**
   * Build a summary dict for a tool (used in the list endpoint).
   */
  private _toolSummary(tool: Tool): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: tool.name,
      description: tool.description ?? "",
    };
    if (tool.annotations) {
      result.annotations = tool.annotations;
    }
    return result;
  }

  /**
   * Build a full detail dict for a tool (used in the detail endpoint).
   */
  private _toolDetail(tool: Tool): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    };
    if (tool.annotations) {
      result.annotations = tool.annotations;
    }
    return result;
  }

  /**
   * Handle GET {prefix}/tools/{name} - return tool detail or 404.
   */
  private _handleToolDetail(res: ServerResponse, toolName: string): void {
    const tool = this._toolsByName.get(toolName);
    if (!tool) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Tool not found: ${toolName}` }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this._toolDetail(tool)));
  }

  /**
   * Handle POST {prefix}/tools/{name}/call - execute tool or return 403/404.
   */
  private async _handleCallTool(
    req: IncomingMessage,
    res: ServerResponse,
    toolName: string,
  ): Promise<void> {
    if (!this._allowExecute) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Tool execution is disabled. Launch with --allow-execute to enable.",
        }),
      );
      return;
    }

    const tool = this._toolsByName.get(toolName);
    if (!tool) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Tool not found: ${toolName}` }));
      return;
    }

    let body: Record<string, unknown> = {};
    try {
      const raw = await readBody(req, EXPLORER_MAX_BODY_BYTES);
      if (raw) {
        body = JSON.parse(raw);
      }
    } catch {
      // Use empty body if parsing fails
    }

    try {
      const [content, isError, traceId] = await this._router.handleCall(toolName, body);

      // Return MCP-compliant CallToolResult format
      const result: Record<string, unknown> = {
        content,
        isError,
      };
      if (traceId) {
        result._meta = { _trace_id: traceId };
      }

      res.writeHead(isError ? 500 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error(`Explorer call_tool error for ${toolName}:`, err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }),
      );
    }
  }
}
