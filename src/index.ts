/**
 * apcore-mcp: Automatic MCP Server & OpenAI Tools Bridge for apcore.
 *
 * Public API:
 * - serve(registryOrExecutor, options?) - Launch an MCP Server
 * - asyncServe(registryOrExecutor, options?) - Build an embeddable HTTP request handler
 * - toOpenaiTools(registryOrExecutor, options?) - Export OpenAI tool definitions
 */

import { createNodeHandler, type Tool as UITool } from "mcp-embedded-ui";
import { OpenAIConverter } from "./converters/openai.js";
import type { ConvertRegistryOptions } from "./converters/openai.js";
import { MCPServerFactory } from "./server/factory.js";
import { ExecutionRouter } from "./server/router.js";
import { TransportManager } from "./server/transport.js";
import { registerMcpNamespace } from "./config.js";
import { registerMcpFormatter } from "./adapters/mcpErrorFormatter.js";
import type { MetricsExporter } from "./server/transport.js";
import type {
  RegistryOrExecutor,
  Registry,
  Executor,
  OpenAIToolDef,
} from "./types.js";
import type { Authenticator } from "./auth/types.js";
import { buildExplorerAuthHook } from "./auth/hooks.js";
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

// ─── Type Exports ────────────────────────────────────────────────────────────
export type { Registry, Executor, RegistryOrExecutor, OpenAIToolDef } from "./types.js";
export type {
  ModuleDescriptor,
  ModuleAnnotations,
  JsonSchema,
  ModuleError,
  McpAnnotationsDict,
  McpErrorResponse,
  TextContentDict,
} from "./types.js";
export { REGISTRY_EVENTS, ErrorCodes, MODULE_ID_PATTERN, APCORE_EVENTS } from "./types.js";

// ─── Extension Helpers ───────────────────────────────────────────────────────
export { reportProgress, elicit, MCP_PROGRESS_KEY, MCP_ELICIT_KEY } from "./helpers.js";
export type { ElicitResult } from "./helpers.js";
export { createBridgeContext } from "./server/context.js";
export type { BridgeContext } from "./server/context.js";

// ─── Auth Exports ────────────────────────────────────────────────────────────
export { JWTAuthenticator } from "./auth/jwt.js";
export type { ClaimMapping, JWTAuthenticatorOptions } from "./auth/jwt.js";
export type { Authenticator, Identity } from "./auth/types.js";
export { identityStorage, getCurrentIdentity } from "./auth/storage.js";
export { buildExplorerAuthHook } from "./auth/hooks.js";

// ─── Unified Entry Point ─────────────────────────────────────────────────────
export { APCoreMCP } from "./apcore-mcp.js";
export type { APCoreMCPOptions, APCoreMCPServeOptions, APCoreMCPAsyncServeOptions } from "./apcore-mcp.js";

// ─── Building Block Exports ──────────────────────────────────────────────────
export { MCPServerFactory } from "./server/factory.js";
export { ExecutionRouter } from "./server/router.js";
export type { CallResult, HandleCallExtra, ExecutionRouterOptions } from "./server/router.js";
export { RegistryListener } from "./server/listener.js";
export { TransportManager } from "./server/transport.js";
export type { MetricsExporter } from "./server/transport.js";
export { AnnotationMapper } from "./adapters/annotations.js";
export { SchemaConverter } from "./adapters/schema.js";
export { ErrorMapper } from "./adapters/errors.js";
export { ModuleIDNormalizer } from "./adapters/idNormalizer.js";
export { ElicitationApprovalHandler } from "./adapters/approval.js";
export type { ApprovalRequest, ApprovalResult } from "./adapters/approval.js";
export { McpErrorFormatter, registerMcpFormatter } from "./adapters/mcpErrorFormatter.js";
export { registerMcpNamespace, MCP_NAMESPACE, MCP_ENV_PREFIX, MCP_DEFAULTS } from "./config.js";
export { OpenAIConverter } from "./converters/openai.js";
export type { ConvertOptions, ConvertRegistryOptions } from "./converters/openai.js";
export type { BuildToolsOptions } from "./server/factory.js";

/**
 * Extract Registry from either a Registry or Executor instance.
 *
 * If the argument has a `registry` property (i.e. it's an Executor),
 * returns that property. Otherwise assumes it's a Registry and returns it directly.
 */
export function resolveRegistry(registryOrExecutor: RegistryOrExecutor): Registry {
  if ("registry" in registryOrExecutor) {
    // It's an Executor — get its registry
    return (registryOrExecutor as Executor).registry;
  }
  // Assume it's a Registry
  return registryOrExecutor as Registry;
}

/**
 * Get or create an Executor from either a Registry or Executor instance.
 *
 * If the argument already has `call` or `callAsync`, returns it directly.
 * If a bare Registry is passed, attempts to dynamically import the Executor
 * from apcore-js and create a default instance (matching Python's resolve_executor).
 *
 * @throws {Error} If the argument is a Registry and apcore-js is not installed.
 */
export async function resolveExecutor(
  registryOrExecutor: RegistryOrExecutor,
  options?: { approvalHandler?: unknown },
): Promise<Executor> {
  if ("call" in registryOrExecutor || "callAsync" in registryOrExecutor) {
    // Already an Executor
    return registryOrExecutor as Executor;
  }
  // It's a bare Registry — create a default Executor
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apcore = await import("apcore-js") as any;
    const ExecutorClass = apcore.Executor ?? apcore.default?.Executor;
    if (ExecutorClass) {
      const executorOpts: Record<string, unknown> = { registry: registryOrExecutor };
      if (options?.approvalHandler) {
        executorOpts.approvalHandler = options.approvalHandler;
      }
      return new ExecutorClass(executorOpts) as Executor;
    }
  } catch {
    // apcore-js not installed — fall through to error
  }
  throw new Error(
    "serve() requires an Executor instance, or apcore-js must be installed to auto-create one from a Registry.",
  );
}

/** Common options shared by serve() and asyncServe(). */
export interface BaseServeOptions {
  /** MCP server name. Default: "apcore-mcp" */
  name?: string;
  /** MCP server version. Default: package version */
  version?: string;
  /** Enable input validation against schemas. Default: false */
  validateInputs?: boolean;
  /** Filter modules by tags. Default: null (no filtering) */
  tags?: string[] | null;
  /** Filter modules by prefix. Default: null (no filtering) */
  prefix?: string | null;
  /** Minimum log level. Suppresses console methods below this level. Default: undefined (no suppression) */
  logLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  /** Optional MetricsCollector for Prometheus /metrics endpoint. */
  metricsCollector?: MetricsExporter;
  /** Enable the browser-based Tool Explorer UI (HTTP transports only). Default: false */
  explorer?: boolean;
  /** URL prefix for the explorer. Default: "/explorer" */
  explorerPrefix?: string;
  /** Allow tool execution from the explorer UI. Default: false */
  allowExecute?: boolean;
  /** Title for the explorer UI page. Default: "APCore MCP Explorer" */
  explorerTitle?: string;
  /** Project name shown in the explorer UI footer. Default: "apcore-mcp" */
  explorerProjectName?: string;
  /** Project URL shown in the explorer UI footer. */
  explorerProjectUrl?: string;
  /** Optional authenticator for request authentication (HTTP transports only). */
  authenticator?: Authenticator;
  /**
   * If true (default), unauthenticated requests are rejected with 401.
   * If false, requests proceed without identity (permissive mode).
   * Overrides the authenticator's own requireAuth when set explicitly.
   */
  requireAuth?: boolean;
  /** Custom paths exempt from authentication. Default: ["/health", "/metrics"] */
  exemptPaths?: string[];
  /** Optional approval handler passed to the Executor (e.g. ElicitationApprovalHandler). */
  approvalHandler?: unknown;
  /**
   * Optional function that formats execution results into text for LLM consumption.
   * When undefined, results are serialised with `JSON.stringify(result)`.
   * Only applied to plain-object results; non-object results always use JSON.stringify.
   */
  outputFormatter?: (result: Record<string, unknown>) => string;
}

/** Options for serve() */
export interface ServeOptions extends BaseServeOptions {
  /** Transport type. Default: "stdio" */
  transport?: "stdio" | "streamable-http" | "sse";
  /** Host address for HTTP-based transports. Default: "127.0.0.1" */
  host?: string;
  /** Port number for HTTP-based transports. Default: 8000 */
  port?: number;
  /** Enable dynamic tool registration/unregistration. Default: false */
  dynamic?: boolean;
  /** Callback invoked before the server starts. */
  onStartup?: () => void | Promise<void>;
  /** Callback invoked after the server stops (or on error). */
  onShutdown?: () => void | Promise<void>;
}

/**
 * Launch an MCP Server that exposes all apcore modules as tools.
 *
 * @param registryOrExecutor - An apcore Registry or Executor instance.
 * @param options - Server configuration options.
 */
export async function serve(
  registryOrExecutor: RegistryOrExecutor,
  options: ServeOptions = {},
): Promise<void> {
  const {
    transport = "stdio",
    host = "127.0.0.1",
    port = 8000,
    name = "apcore-mcp",
    version = VERSION,
    validateInputs,
    tags,
    prefix,
    logLevel,
    onStartup,
    onShutdown,
    metricsCollector,
    explorer = false,
    explorerPrefix = "/explorer",
    allowExecute = false,
    explorerTitle = "APCore MCP Explorer",
    explorerProjectName = "apcore-mcp",
    explorerProjectUrl = "https://github.com/aiperceivable/apcore-mcp-typescript",
    authenticator,
    requireAuth,
    exemptPaths,
    approvalHandler,
    outputFormatter,
  } = options;

  // Input validation (matching Python's checks)
  if (!name || name.length === 0) {
    throw new Error("name must not be empty");
  }
  if (name.length > 255) {
    throw new Error("name must not exceed 255 characters");
  }
  if (tags) {
    for (const tag of tags) {
      if (!tag || tag.length === 0) {
        throw new Error("tags must not contain empty strings");
      }
    }
  }
  if (prefix !== undefined && prefix !== null && prefix.length === 0) {
    throw new Error("prefix must not be empty if provided");
  }
  if (explorer && !explorerPrefix.startsWith("/")) {
    throw new Error("explorerPrefix must start with '/'");
  }

  // Save original console methods before suppression
  const origDebug = console.debug;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;

  // Apply log-level suppression
  if (logLevel) {
    const levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
    const minLevel = levels.indexOf(logLevel);
    if (minLevel > 0) console.debug = () => { };
    if (minLevel > 1) console.info = () => { };
    if (minLevel > 2) console.warn = () => { };
    if (minLevel > 3) console.error = () => { };
  }

  const registry = resolveRegistry(registryOrExecutor);
  const executor = await resolveExecutor(registryOrExecutor, { approvalHandler });

  // Register MCP config namespace and error formatter (idempotent)
  registerMcpNamespace();
  await registerMcpFormatter();

  // Build MCP server components
  const factory = new MCPServerFactory();
  const server = factory.createServer(name, version);
  const tools = factory.buildTools(registry, { tags, prefix });
  const router = new ExecutionRouter(executor, { validateInputs, outputFormatter });
  factory.registerHandlers(server, tools, router);
  factory.registerResourceHandlers(server, registry);

  origInfo(
    `Starting MCP server '${name}' v${version} with ${tools.length} tools via ${transport}`,
  );

  // Invoke startup callback
  await onStartup?.();

  // Select and run transport
  const transportManager = new TransportManager();
  transportManager.setModuleCount(tools.length);
  if (metricsCollector) {
    transportManager.setMetricsCollector(metricsCollector);
  }
  if (authenticator) {
    transportManager.setAuthenticator(authenticator);
  }
  if (requireAuth !== undefined) {
    transportManager.setRequireAuth(requireAuth);
  }
  if (exemptPaths) {
    transportManager.setExemptPaths(exemptPaths);
  }

  // Mount explorer for HTTP transports only
  const transportLower = transport.toLowerCase();
  if (explorer && (transportLower === "streamable-http" || transportLower === "sse")) {
    // Build auth hook for POST (tool execution) calls
    const authHook = authenticator
      ? buildExplorerAuthHook(authenticator)
      : undefined;

    const explorerNodeHandler = createNodeHandler(
      tools as UITool[],
      async (name: string, args: Record<string, unknown>) => router.handleCall(name, args),
      {
        prefix: explorerPrefix,
        allowExecute,
        authHook,
        title: explorerTitle,
        projectName: explorerProjectName,
        projectUrl: explorerProjectUrl,
      },
    );
    transportManager.setExplorer(explorerNodeHandler, explorerPrefix);
    origInfo(`Tool Explorer enabled at ${explorerPrefix}`);
  }

  try {
    if (transport === "stdio") {
      await transportManager.runStdio(server);
    } else if (transport === "streamable-http") {
      await transportManager.runStreamableHttp(server, { host, port });
    } else if (transport === "sse") {
      await transportManager.runSse(server, { host, port });
    } else {
      throw new Error(
        `Unknown transport: '${transport as string}'. Expected 'stdio', 'streamable-http', or 'sse'.`,
      );
    }
  } finally {
    console.debug = origDebug;
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origError;
    await onShutdown?.();
  }
}

/** Options for asyncServe() — extends BaseServeOptions with embed-specific options. */
export interface AsyncServeOptions extends BaseServeOptions {
  /** MCP endpoint path. Default: "/mcp" */
  endpoint?: string;
}

/** Return type of asyncServe(). */
export interface AsyncServeApp {
  /** Node.js HTTP request handler — mount this in your HTTP server. */
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>;
  /** Clean up the MCP transport. Call this when shutting down. */
  close: () => Promise<void>;
}

/**
 * Build an embeddable MCP HTTP request handler for mounting into a larger server.
 *
 * Unlike `serve()`, this does NOT create its own HTTP server. Instead it returns
 * a Node.js HTTP request handler that you can wire into `http.createServer()`,
 * Express, or any framework that accepts `(req, res) => void`.
 *
 * This is the TypeScript equivalent of Python's `async_serve()` context manager
 * that yields a Starlette ASGI app.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * import { asyncServe } from "apcore-mcp";
 *
 * const { handler, close } = await asyncServe(registry, { explorer: true });
 *
 * const server = createServer((req, res) => {
 *   // Mount MCP under /mcp prefix or handle other routes
 *   handler(req, res);
 * });
 * server.listen(8000);
 *
 * // On shutdown:
 * await close();
 * ```
 */
export async function asyncServe(
  registryOrExecutor: RegistryOrExecutor,
  options: AsyncServeOptions = {},
): Promise<AsyncServeApp> {
  const {
    name = "apcore-mcp",
    version = VERSION,
    validateInputs,
    tags,
    prefix,
    logLevel,
    metricsCollector,
    explorer = false,
    explorerPrefix = "/explorer",
    allowExecute = false,
    explorerTitle = "APCore MCP Explorer",
    explorerProjectName = "apcore-mcp",
    explorerProjectUrl = "https://github.com/aiperceivable/apcore-mcp-typescript",
    authenticator,
    requireAuth,
    exemptPaths,
    approvalHandler,
    endpoint,
    outputFormatter,
  } = options;

  // Input validation (same as serve())
  if (!name || name.length === 0) {
    throw new Error("name must not be empty");
  }
  if (name.length > 255) {
    throw new Error("name must not exceed 255 characters");
  }
  if (tags) {
    for (const tag of tags) {
      if (!tag || tag.length === 0) {
        throw new Error("tags must not contain empty strings");
      }
    }
  }
  if (prefix !== undefined && prefix !== null && prefix.length === 0) {
    throw new Error("prefix must not be empty if provided");
  }
  if (explorer && !explorerPrefix.startsWith("/")) {
    throw new Error("explorerPrefix must start with '/'");
  }

  // Save original console methods before suppression
  const origDebug = console.debug;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;

  // Apply log-level suppression
  if (logLevel) {
    const levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
    const minLevel = levels.indexOf(logLevel);
    if (minLevel > 0) console.debug = () => { };
    if (minLevel > 1) console.info = () => { };
    if (minLevel > 2) console.warn = () => { };
    if (minLevel > 3) console.error = () => { };
  }

  const registry = resolveRegistry(registryOrExecutor);
  const executor = await resolveExecutor(registryOrExecutor, { approvalHandler });

  // Register MCP config namespace and error formatter (idempotent)
  registerMcpNamespace();
  await registerMcpFormatter();

  // Build MCP server components
  const factory = new MCPServerFactory();
  const server = factory.createServer(name, version);
  const tools = factory.buildTools(registry, { tags, prefix });
  const router = new ExecutionRouter(executor, { validateInputs, outputFormatter });
  factory.registerHandlers(server, tools, router);
  factory.registerResourceHandlers(server, registry);

  console.info(
    `Building MCP app '${name}' v${version} with ${tools.length} tools`,
  );

  // Configure transport manager
  const transportManager = new TransportManager();
  transportManager.setModuleCount(tools.length);
  if (metricsCollector) {
    transportManager.setMetricsCollector(metricsCollector);
  }
  if (authenticator) {
    transportManager.setAuthenticator(authenticator);
  }
  if (requireAuth !== undefined) {
    transportManager.setRequireAuth(requireAuth);
  }
  if (exemptPaths) {
    transportManager.setExemptPaths(exemptPaths);
  }

  // Mount explorer
  if (explorer) {
    const authHook = authenticator
      ? buildExplorerAuthHook(authenticator)
      : undefined;

    const explorerNodeHandler = createNodeHandler(
      tools as UITool[],
      async (name: string, args: Record<string, unknown>) => router.handleCall(name, args),
      {
        prefix: explorerPrefix,
        allowExecute,
        authHook,
        title: explorerTitle,
        projectName: explorerProjectName,
        projectUrl: explorerProjectUrl,
      },
    );
    transportManager.setExplorer(explorerNodeHandler, explorerPrefix);
    console.info(`Tool Explorer enabled at ${explorerPrefix}`);
  }

  // Build the embeddable HTTP handler, wrapping close() to restore console methods
  const app = await transportManager.buildStreamableHttpApp(server, { endpoint });
  const originalClose = app.close;
  app.close = async () => {
    await originalClose();
    console.debug = origDebug;
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origError;
  };
  return app;
}

/** Options for toOpenaiTools() */
export interface ToOpenaiToolsOptions extends ConvertRegistryOptions { }

/**
 * Export apcore Registry modules as OpenAI-compatible tool definitions.
 *
 * @param registryOrExecutor - An apcore Registry or Executor instance.
 * @param options - Conversion options.
 * @returns List of OpenAI tool definition dicts.
 */
export function toOpenaiTools(
  registryOrExecutor: RegistryOrExecutor,
  options: ToOpenaiToolsOptions = {},
): OpenAIToolDef[] {
  const registry = resolveRegistry(registryOrExecutor);
  const converter = new OpenAIConverter();
  const tools = converter.convertRegistry(registry, options);
  return tools;
}
