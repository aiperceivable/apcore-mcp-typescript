/**
 * TransportManager - Manages MCP server transport lifecycle.
 *
 * Supports three transport modes:
 * - stdio: Standard input/output (fully implemented)
 * - streamableHttp: Streamable HTTP with SSE support
 * - sse: Legacy Server-Sent Events transport
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

/** Options for HTTP-based transports. */
export interface HttpTransportOptions {
  host: string;
  port: number;
  endpoint?: string;
}

/**
 * Read the full request body as a string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export class TransportManager {
  /** The underlying HTTP server, if an HTTP-based transport is active. */
  httpServer?: HttpServer;

  /**
   * Run the server using stdio transport.
   *
   * Creates a StdioServerTransport and connects it to the server.
   * This is the standard transport for CLI-based MCP servers.
   *
   * @param server - The MCP Server instance to connect
   */
  async runStdio(server: Server): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  /**
   * Run the server using Streamable HTTP transport.
   *
   * Creates a StreamableHTTPServerTransport and sets up an HTTP server
   * to handle requests.
   *
   * @param server - The MCP Server instance to connect
   * @param options - Host, port, and optional endpoint configuration
   */
  async runStreamableHttp(
    server: Server,
    options: HttpTransportOptions,
  ): Promise<void> {
    this._validateHostPort(options.host, options.port);

    const endpoint = options.endpoint ?? "/mcp";

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await server.connect(transport);

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${options.host}:${options.port}`);

      if (url.pathname !== endpoint) {
        res.writeHead(404).end("Not Found");
        return;
      }

      try {
        if (req.method === "POST" || req.method === "DELETE") {
          const body = await readBody(req);
          const parsed = body ? JSON.parse(body) : undefined;
          await transport.handleRequest(req, res, parsed);
        } else {
          await transport.handleRequest(req, res);
        }
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500).end("Internal Server Error");
        }
      }
    });

    this.httpServer = httpServer;

    return new Promise((resolve) => {
      httpServer.listen(options.port, options.host, () => {
        const addr = httpServer.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : options.port;
        console.info(
          `StreamableHTTP transport listening on ${options.host}:${actualPort}${endpoint}`,
        );
        resolve();
      });
    });
  }

  /**
   * Run the server using SSE (Server-Sent Events) transport.
   *
   * Creates an HTTP server that handles SSE connections (GET) and
   * message posting (POST). Each SSE connection creates a new
   * SSEServerTransport instance.
   *
   * @param server - The MCP Server instance to connect
   * @param options - Host, port, and optional endpoint configuration
   */
  async runSse(
    server: Server,
    options: HttpTransportOptions,
  ): Promise<void> {
    this._validateHostPort(options.host, options.port);

    const endpoint = options.endpoint ?? "/sse";
    const messagesEndpoint = "/messages";
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${options.host}:${options.port}`);

      if (url.pathname === endpoint && req.method === "GET") {
        // Establish SSE connection
        const transport = new SSEServerTransport(messagesEndpoint, res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        transport.onclose = () => {
          transports.delete(sessionId);
        };

        await server.connect(transport);
        await transport.start();
      } else if (url.pathname === messagesEndpoint && req.method === "POST") {
        // Route message to the correct session transport
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          res.writeHead(400).end("Missing sessionId parameter");
          return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
          res.writeHead(400).end("Unknown session");
          return;
        }

        try {
          const body = await readBody(req);
          const parsed = body ? JSON.parse(body) : undefined;
          await transport.handlePostMessage(req, res, parsed);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500).end("Internal Server Error");
          }
        }
      } else {
        res.writeHead(404).end("Not Found");
      }
    });

    this.httpServer = httpServer;

    return new Promise((resolve) => {
      httpServer.listen(options.port, options.host, () => {
        const addr = httpServer.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : options.port;
        console.info(
          `SSE transport listening on ${options.host}:${actualPort}${endpoint}`,
        );
        resolve();
      });
    });
  }

  /**
   * Close the HTTP server if one is running.
   */
  async close(): Promise<void> {
    if (!this.httpServer) return;

    return new Promise((resolve) => {
      this.httpServer!.close(() => resolve());
    });
  }

  /**
   * Validate host and port parameters for HTTP transports.
   *
   * @param host - Must be a non-empty string
   * @param port - Must be an integer between 1 and 65535
   * @throws Error if validation fails
   */
  _validateHostPort(host: string, port: number): void {
    if (!host || typeof host !== "string" || host.trim().length === 0) {
      throw new Error("Host must be a non-empty string");
    }

    if (
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error("Port must be an integer between 1 and 65535");
    }
  }
}
