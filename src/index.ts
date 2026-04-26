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
import { RegistryListener } from "./server/listener.js";
import { TransportManager } from "./server/transport.js";
import { registerMcpNamespace } from "./config.js";
import { registerMcpFormatter } from "./adapters/mcpErrorFormatter.js";
import type { MetricsExporter } from "./server/transport.js";
import { installObservability, type ObservabilityFlag } from "./server/observability.js";
import { createAsyncTaskBridge, type AsyncTaskBridge } from "./server/asyncTaskBridge.js";
import type {
  RegistryOrExecutor,
  Registry,
  Executor,
  ModuleDescriptor,
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
export type { MetricsExporter, UsageExporter } from "./server/transport.js";
export { AsyncTaskBridge, createAsyncTaskBridge, META_TOOL_NAMES, APCORE_META_TOOL_PREFIX } from "./server/asyncTaskBridge.js";
export type { AsyncTaskManagerLike, TaskInfoProjection, AsyncMetaTool, AsyncTaskBridgeOptions } from "./server/asyncTaskBridge.js";
export { installObservability } from "./server/observability.js";
export type { ObservabilityFlag, ObservabilityStack } from "./server/observability.js";
export { parseTraceparent, buildTraceparent } from "./server/traceContext.js";
export type { ParsedTraceParent } from "./server/traceContext.js";
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
  options?: {
    approvalHandler?: unknown;
    strategy?: string;
    middleware?: unknown[];
    acl?: unknown;
  },
): Promise<Executor> {
  let executor: Executor | undefined;

  if ("call" in registryOrExecutor || "callAsync" in registryOrExecutor) {
    // Already an Executor
    if (options?.strategy) {
      console.warn(
        `strategy='${options.strategy}' ignored: input is already an Executor instance.`,
      );
    }
    executor = registryOrExecutor as Executor;
  } else {
    // It's a bare Registry — create a default Executor
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apcore = (await import("apcore-js")) as any;
      const ExecutorClass = apcore.Executor ?? apcore.default?.Executor;
      if (ExecutorClass) {
        const executorOpts: Record<string, unknown> = {
          registry: registryOrExecutor,
        };
        if (options?.approvalHandler) {
          executorOpts.approvalHandler = options.approvalHandler;
        }
        if (options?.strategy) {
          executorOpts.strategy = options.strategy;
        }
        executor = new ExecutorClass(executorOpts) as Executor;
      }
    } catch {
      // apcore-js not installed — fall through to error
    }
    if (!executor) {
      throw new Error(
        "serve() requires an Executor instance, or apcore-js must be installed to auto-create one from a Registry.",
      );
    }
  }

  // Apply middleware via executor.use() per instance. Mirrors the Python
  // bridge's resolve_executor contract.
  const middleware = options?.middleware ?? [];
  if (middleware.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useFn = (executor as any).use;
    if (typeof useFn !== "function") {
      throw new Error(
        "Executor does not support .use() — 'middleware' option requires apcore-js>=0.18",
      );
    }
    for (const mw of middleware) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (executor as any).use(mw);
    }
  }

  // Install ACL via executor.setAcl() if provided.
  if (options?.acl !== undefined && options.acl !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setAcl = (executor as any).setAcl;
    if (typeof setAcl !== "function") {
      throw new Error(
        "Executor does not support .setAcl() — 'acl' option requires apcore-js>=0.18",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (executor as any).setAcl(options.acl);
  }

  return executor;
}

/**
 * Build a map of module_id → output_schema from the registry.
 *
 * Only includes modules whose output_schema is a non-empty object.
 */
function buildOutputSchemaMap(registry: Registry): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  for (const moduleId of registry.list()) {
    const def = registry.getDefinition(moduleId);
    if (def?.outputSchema && Object.keys(def.outputSchema).length > 0) {
      map[moduleId] = def.outputSchema;
    }
  }
  return map;
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
  /**
   * Optional MetricsCollector for Prometheus /metrics endpoint.
   *
   * - Pass a concrete `MetricsExporter` instance to surface its output on
   *   the `/metrics` endpoint (existing behaviour).
   * - Pass `true` to auto-instantiate apcore-js's `MetricsCollector` and
   *   install `MetricsMiddleware` via `executor.use()`.
   */
  metricsCollector?: MetricsExporter | boolean;
  /**
   * Enable the full observability stack (metrics + usage middleware). When
   * `true`, apcore-js's `MetricsCollector` + `MetricsMiddleware` AND
   * `UsageCollector` + `UsageMiddleware` are auto-instantiated and installed
   * on the executor. The transport exposes `/metrics` and `/usage` endpoints.
   */
  observability?: ObservabilityFlag;
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
  /** Execution strategy name passed to the Executor constructor (e.g. "standard", "internal"). */
  strategy?: string;
  /**
   * Optional function that formats execution results into text for LLM consumption.
   * When undefined, results are serialised with `JSON.stringify(result)`.
   * Only applied to plain-object results; non-object results always use JSON.stringify.
   */
  outputFormatter?: (result: Record<string, unknown>) => string;
  /**
   * When true (default), redact sensitive fields from tool output using apcore's
   * `redactSensitive()` before formatting. Requires apcore-js to be installed.
   */
  redactOutput?: boolean;
  /**
   * When true, enable pipeline trace via callWithTrace(). Adds `_meta.trace`
   * to non-streaming tool responses. Default: false.
   */
  trace?: boolean;
  /**
   * Optional list of apcore `Middleware` instances to install on the Executor
   * via `executor.use()`. Appended to any middleware declared under Config
   * Bus key `mcp.middleware`. Chain execution order is controlled by
   * `Middleware.priority`, not insertion order.
   */
  middleware?: unknown[];
  /**
   * Optional apcore `ACL` instance to install via `executor.setAcl()`.
   * When omitted, the bridge falls back to any ACL declared under Config
   * Bus key `mcp.acl` (rules + default_effect). Caller-supplied ACL takes
   * precedence over Config Bus.
   */
  acl?: unknown;
  /**
   * Configure the Async Task Bridge (F-043). When `true` (default),
   * async-hinted modules (`metadata.async === true` OR
   * `annotations.extra["mcp_async"] === "true"`) route through the
   * AsyncTaskManager and the four `__apcore_task_*` meta-tools are
   * advertised. Pass `false` to disable entirely or an object for
   * fine-grained tuning.
   */
  async?: boolean | { enabled?: boolean; maxConcurrent?: number; maxTasks?: number };
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
    redactOutput,
    strategy,
    trace,
    middleware: callerMiddleware,
    acl: callerAcl,
    observability: observabilityFlag,
    async: asyncFlag,
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

  // ── F-040: YAML Pipeline Config via Config Bus ─────────────────────
  let resolvedStrategy = strategy;
  let configMiddleware: unknown[] = [];
  let configAcl: unknown | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apcoreConfig = await import("apcore-js") as any;
    const Config = apcoreConfig.Config ?? apcoreConfig.default?.Config;
    const buildStrategyFromConfig = apcoreConfig.buildStrategyFromConfig ?? apcoreConfig.default?.buildStrategyFromConfig;
    if (Config && buildStrategyFromConfig) {
      const config = typeof Config.getInstance === 'function' ? Config.getInstance() : new Config();
      const pipelineCfg = config.get?.("mcp.pipeline");
      if (pipelineCfg && typeof pipelineCfg === 'object' && Object.keys(pipelineCfg).length > 0) {
        if (resolvedStrategy) {
          console.warn(
            `YAML pipeline config found in Config Bus — overriding strategy='${resolvedStrategy}' with config-driven strategy.`,
          );
        }
        resolvedStrategy = buildStrategyFromConfig(pipelineCfg);
      }
      // Load declarative middleware from Config Bus (`mcp.middleware`).
      const mwCfg = config.get?.("mcp.middleware");
      if (Array.isArray(mwCfg) && mwCfg.length > 0) {
        const { buildMiddlewareFromConfig } = await import(
          "./middleware-builder.js"
        );
        configMiddleware = await buildMiddlewareFromConfig(mwCfg);
      }
      // Load declarative ACL from Config Bus (`mcp.acl`).
      const aclCfg = config.get?.("mcp.acl");
      if (aclCfg) {
        const { buildAclFromConfig } = await import("./acl-builder.js");
        configAcl = await buildAclFromConfig(aclCfg);
      }
    }
  } catch {
    // apcore-js not installed or Config Bus not available — use strategy param as-is
  }

  const combinedMiddleware: unknown[] = [...configMiddleware];
  if (callerMiddleware && callerMiddleware.length > 0) {
    combinedMiddleware.push(...callerMiddleware);
  }

  // Caller-supplied ACL wins over Config Bus.
  const effectiveAcl = callerAcl !== undefined ? callerAcl : configAcl;

  const registry = resolveRegistry(registryOrExecutor);
  const executor = await resolveExecutor(registryOrExecutor, {
    approvalHandler,
    strategy: resolvedStrategy,
    middleware: combinedMiddleware,
    acl: effectiveAcl,
  });

  // ── F-044: observability auto-wire (metrics + usage middleware) ──────
  const obsStack = await installObservability(
    executor,
    metricsCollector,
    observabilityFlag,
  );
  const resolvedMetricsCollector = obsStack.metricsCollector;

  // Register MCP config namespace and error formatter (idempotent)
  registerMcpNamespace();
  await registerMcpFormatter();

  // Build output schema map for redaction
  const outputSchemaMap = buildOutputSchemaMap(registry);

  // ── F-043: AsyncTaskBridge ───────────────────────────────────────────
  const asyncOpt = typeof asyncFlag === "object" ? asyncFlag : null;
  const asyncEnabled = asyncFlag === undefined ? true : asyncFlag !== false;
  const asyncBridge: AsyncTaskBridge | null = asyncEnabled
    ? await createAsyncTaskBridge(executor, {
        enabled: true,
        maxConcurrent: asyncOpt?.maxConcurrent,
        maxTasks: asyncOpt?.maxTasks,
        outputSchemaMap,
        // [A-D-008]: enable ASYNC_MODULE_NOT_ASYNC enforcement on
        // __apcore_task_submit by giving the bridge a way to fetch the
        // descriptor for a module id.
        descriptorLookup: (moduleId: string) =>
          (registry as { getDefinition?: (id: string) => ModuleDescriptor | null | undefined })
            .getDefinition?.(moduleId) ?? null,
      })
    : null;

  // Build MCP server components
  const factory = new MCPServerFactory();
  const server = factory.createServer(name, version);
  let tools = factory.buildTools(registry, { tags, prefix });
  tools = factory.attachAsyncMetaTools(tools, asyncBridge ?? undefined);
  const router = new ExecutionRouter(executor, {
    validateInputs,
    outputFormatter,
    redactOutput,
    outputSchemaMap,
    trace,
    asyncTaskBridge: asyncBridge ?? undefined,
  });
  factory.registerHandlers(server, tools, router);
  factory.registerResourceHandlers(server, registry);

  // Start dynamic tool registration listener if enabled
  if (options.dynamic) {
    const listener = new RegistryListener(registry, factory);
    listener.start();
    origInfo("Dynamic tool registration enabled via RegistryListener");
  }

  origInfo(
    `Starting MCP server '${name}' v${version} with ${tools.length} tools via ${transport}`,
  );

  // Invoke startup callback
  await onStartup?.();

  // Select and run transport
  const transportManager = new TransportManager();
  transportManager.setModuleCount(tools.length);
  if (resolvedMetricsCollector) {
    transportManager.setMetricsCollector(resolvedMetricsCollector);
  }
  if (obsStack.usageCollector) {
    transportManager.setUsageCollector(obsStack.usageCollector);
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
    if (asyncBridge?.manager.shutdown) {
      try {
        await asyncBridge.manager.shutdown();
      } catch (err) {
        origWarn("[apcore-mcp] AsyncTaskManager shutdown failed:", err);
      }
    }
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
    redactOutput,
    strategy,
    trace,
    middleware: callerMiddleware,
    acl: callerAcl,
    observability: observabilityFlag,
    async: asyncFlag,
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

  // ── F-040: YAML Pipeline Config via Config Bus ─────────────────────
  let resolvedStrategy = strategy;
  let configMiddleware: unknown[] = [];
  let configAcl: unknown | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apcoreConfig = await import("apcore-js") as any;
    const Config = apcoreConfig.Config ?? apcoreConfig.default?.Config;
    const buildStrategyFromConfig = apcoreConfig.buildStrategyFromConfig ?? apcoreConfig.default?.buildStrategyFromConfig;
    if (Config && buildStrategyFromConfig) {
      const config = typeof Config.getInstance === 'function' ? Config.getInstance() : new Config();
      const pipelineCfg = config.get?.("mcp.pipeline");
      if (pipelineCfg && typeof pipelineCfg === 'object' && Object.keys(pipelineCfg).length > 0) {
        if (resolvedStrategy) {
          console.warn(
            `YAML pipeline config found in Config Bus — overriding strategy='${resolvedStrategy}' with config-driven strategy.`,
          );
        }
        resolvedStrategy = buildStrategyFromConfig(pipelineCfg);
      }
      // Load declarative middleware from Config Bus (`mcp.middleware`).
      const mwCfg = config.get?.("mcp.middleware");
      if (Array.isArray(mwCfg) && mwCfg.length > 0) {
        const { buildMiddlewareFromConfig } = await import(
          "./middleware-builder.js"
        );
        configMiddleware = await buildMiddlewareFromConfig(mwCfg);
      }
      // Load declarative ACL from Config Bus (`mcp.acl`).
      const aclCfg = config.get?.("mcp.acl");
      if (aclCfg) {
        const { buildAclFromConfig } = await import("./acl-builder.js");
        configAcl = await buildAclFromConfig(aclCfg);
      }
    }
  } catch {
    // apcore-js not installed or Config Bus not available — use strategy param as-is
  }

  const combinedMiddleware: unknown[] = [...configMiddleware];
  if (callerMiddleware && callerMiddleware.length > 0) {
    combinedMiddleware.push(...callerMiddleware);
  }

  // Caller-supplied ACL wins over Config Bus.
  const effectiveAcl = callerAcl !== undefined ? callerAcl : configAcl;

  const registry = resolveRegistry(registryOrExecutor);
  const executor = await resolveExecutor(registryOrExecutor, {
    approvalHandler,
    strategy: resolvedStrategy,
    middleware: combinedMiddleware,
    acl: effectiveAcl,
  });

  // ── F-044: observability auto-wire ───────────────────────────────────
  const obsStack = await installObservability(
    executor,
    metricsCollector,
    observabilityFlag,
  );
  const resolvedMetricsCollector = obsStack.metricsCollector;

  // Register MCP config namespace and error formatter (idempotent)
  registerMcpNamespace();
  await registerMcpFormatter();

  // Build output schema map for redaction
  const outputSchemaMap = buildOutputSchemaMap(registry);

  // ── F-043: AsyncTaskBridge ───────────────────────────────────────────
  const asyncOpt = typeof asyncFlag === "object" ? asyncFlag : null;
  const asyncEnabled = asyncFlag === undefined ? true : asyncFlag !== false;
  const asyncBridge: AsyncTaskBridge | null = asyncEnabled
    ? await createAsyncTaskBridge(executor, {
        enabled: true,
        maxConcurrent: asyncOpt?.maxConcurrent,
        maxTasks: asyncOpt?.maxTasks,
        outputSchemaMap,
        // [A-D-008]: enable ASYNC_MODULE_NOT_ASYNC enforcement on
        // __apcore_task_submit by giving the bridge a way to fetch the
        // descriptor for a module id.
        descriptorLookup: (moduleId: string) =>
          (registry as { getDefinition?: (id: string) => ModuleDescriptor | null | undefined })
            .getDefinition?.(moduleId) ?? null,
      })
    : null;

  // Build MCP server components
  const factory = new MCPServerFactory();
  const server = factory.createServer(name, version);
  let tools = factory.buildTools(registry, { tags, prefix });
  tools = factory.attachAsyncMetaTools(tools, asyncBridge ?? undefined);
  const router = new ExecutionRouter(executor, {
    validateInputs,
    outputFormatter,
    redactOutput,
    outputSchemaMap,
    trace,
    asyncTaskBridge: asyncBridge ?? undefined,
  });
  factory.registerHandlers(server, tools, router);
  factory.registerResourceHandlers(server, registry);

  console.info(
    `Building MCP app '${name}' v${version} with ${tools.length} tools`,
  );

  // Configure transport manager
  const transportManager = new TransportManager();
  transportManager.setModuleCount(tools.length);
  if (resolvedMetricsCollector) {
    transportManager.setMetricsCollector(resolvedMetricsCollector);
  }
  if (obsStack.usageCollector) {
    transportManager.setUsageCollector(obsStack.usageCollector);
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
    if (asyncBridge?.manager.shutdown) {
      try {
        await asyncBridge.manager.shutdown();
      } catch (err) {
        origWarn("[apcore-mcp] AsyncTaskManager shutdown failed:", err);
      }
    }
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
