/**
 * APCoreMCP: Unified entry point for apcore-mcp.
 *
 * Wraps Registry discovery, MCP server creation, and OpenAI tool export
 * into a single object with a simple API.
 *
 * @example
 * ```ts
 * // Minimal — just point to extensions
 * const mcp = new APCoreMCP("./extensions");
 * await mcp.serve();
 *
 * // With options
 * const mcp = new APCoreMCP("./extensions", { name: "my-server", tags: ["public"] });
 * await mcp.serve({ transport: "streamable-http", port: 9000, explorer: true });
 *
 * // Export OpenAI tools
 * const tools = mcp.toOpenaiTools();
 *
 * // Embed into existing HTTP server
 * const app = await mcp.asyncServe({ explorer: true });
 * // app.handler is a Node.js request handler; call app.close() on shutdown
 *
 * // Use existing Registry or Executor
 * const mcp = new APCoreMCP(registry);
 * ```
 */

import type {
  RegistryOrExecutor,
  Registry,
  Executor,
  OpenAIToolDef,
} from "./types.js";
import type { Authenticator } from "./auth/types.js";
import type { MetricsExporter } from "./server/transport.js";
import {
  serve,
  asyncServe,
  toOpenaiTools,
  resolveRegistry,
} from "./index.js";
import type {
  ServeOptions,
  AsyncServeOptions,
  AsyncServeApp,
  ToOpenaiToolsOptions,
} from "./index.js";

/** Options for the APCoreMCP constructor. */
export interface APCoreMCPOptions {
  /** MCP server name. Default: "apcore-mcp" */
  name?: string;
  /** MCP server version. Default: package version */
  version?: string;
  /** Filter modules by tags. */
  tags?: string[] | null;
  /** Filter modules by prefix. */
  prefix?: string | null;
  /** Minimum log level. */
  logLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  /** Enable input validation against schemas. Default: false */
  validateInputs?: boolean;
  /** Optional MetricsCollector for Prometheus /metrics endpoint. */
  metricsCollector?: MetricsExporter;
  /** Optional authenticator for request authentication (HTTP transports only). */
  authenticator?: Authenticator;
  /** If true (default), unauthenticated requests are rejected with 401. */
  requireAuth?: boolean;
  /** Custom paths exempt from authentication. */
  exemptPaths?: string[];
  /** Optional approval handler passed to the Executor. */
  approvalHandler?: unknown;
  /**
   * Optional function that formats execution results into text for LLM consumption.
   * When undefined, results are serialised with `JSON.stringify(result)`.
   */
  outputFormatter?: (result: Record<string, unknown>) => string;
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
   * Bus key `mcp.acl`. Caller-supplied ACL takes precedence over Config Bus.
   */
  acl?: unknown;
}

/** Options for APCoreMCP.serve() (transport + lifecycle subset). */
export interface APCoreMCPServeOptions {
  /** Transport type. Default: "stdio" */
  transport?: "stdio" | "streamable-http" | "sse";
  /** Host address for HTTP-based transports. Default: "127.0.0.1" */
  host?: string;
  /** Port number for HTTP-based transports. Default: 8000 */
  port?: number;
  /** Callback invoked before the server starts. */
  onStartup?: () => void | Promise<void>;
  /** Callback invoked after the server stops. */
  onShutdown?: () => void | Promise<void>;
  /** Enable the browser-based Tool Explorer UI (HTTP only). Default: false */
  explorer?: boolean;
  /** URL prefix for the explorer. Default: "/explorer" */
  explorerPrefix?: string;
  /** Allow tool execution from the explorer UI. Default: false */
  allowExecute?: boolean;
  /** Title for the explorer UI page. */
  explorerTitle?: string;
  /** Project name shown in the explorer UI footer. */
  explorerProjectName?: string;
  /** Project URL shown in the explorer UI footer. */
  explorerProjectUrl?: string;
}

/** Options for APCoreMCP.asyncServe() (embed subset). */
export interface APCoreMCPAsyncServeOptions {
  /** Enable the browser-based Tool Explorer UI. Default: false */
  explorer?: boolean;
  /** URL prefix for the explorer. Default: "/explorer" */
  explorerPrefix?: string;
  /** Allow tool execution from the explorer UI. Default: false */
  allowExecute?: boolean;
  /** Title for the explorer UI page. */
  explorerTitle?: string;
  /** Project name shown in the explorer UI footer. */
  explorerProjectName?: string;
  /** Project URL shown in the explorer UI footer. */
  explorerProjectUrl?: string;
  /** MCP endpoint path. Default: "/mcp" */
  endpoint?: string;
}

export class APCoreMCP {
  private _backend: RegistryOrExecutor | null;
  private readonly _options: APCoreMCPOptions;
  private _registry: Registry | undefined;
  private _executor: Executor | undefined;
  private readonly _extensionsDir: string | undefined;

  /**
   * Create an APCoreMCP instance.
   *
   * @param extensionsDirOrBackend - Path to an apcore extensions directory,
   *   or an existing Registry or Executor instance.
   * @param options - Configuration options.
   */
  constructor(
    extensionsDirOrBackend: string | RegistryOrExecutor,
    options: APCoreMCPOptions = {},
  ) {
    // Validate upfront
    const name = options.name ?? "apcore-mcp";
    if (!name || name.length === 0) {
      throw new Error("name must not be empty");
    }
    if (name.length > 255) {
      throw new Error("name must not exceed 255 characters");
    }
    if (options.tags) {
      for (const tag of options.tags) {
        if (!tag || tag.length === 0) {
          throw new Error("tags must not contain empty strings");
        }
      }
    }
    if (options.prefix !== undefined && options.prefix !== null && options.prefix.length === 0) {
      throw new Error("prefix must not be empty if provided");
    }

    this._options = { name, ...options };

    if (typeof extensionsDirOrBackend === "string") {
      // Defer discovery to first use — will be resolved lazily
      this._backend = null;
      this._extensionsDir = extensionsDirOrBackend;
    } else {
      this._backend = extensionsDirOrBackend;
      this._extensionsDir = undefined;
    }
  }

  /** The underlying apcore Registry. */
  get registry(): Registry {
    if (!this._registry) {
      if (this._backend !== null) {
        this._registry = resolveRegistry(this._backend);
      } else {
        throw new Error(
          "Registry not yet resolved. Call serve() or asyncServe() first, " +
          "or pass a Registry/Executor to the constructor.",
        );
      }
    }
    return this._registry;
  }

  /** The underlying apcore Executor (resolved lazily). */
  get executor(): Executor | undefined {
    return this._executor;
  }

  /** List all discovered module IDs that will be exposed as tools. */
  get tools(): string[] {
    const reg = this.registry;
    const result = reg.list({
      tags: this._options.tags ?? undefined,
      prefix: this._options.prefix ?? undefined,
    });
    // registry.list() may return ModuleDescriptor[] or string[] depending on apcore-js version
    if (result.length === 0) return [];
    if (typeof result[0] === "string") return result as string[];
    return (result as unknown as Array<{ moduleId: string }>).map((d) => d.moduleId);
  }

  /**
   * Build the full ServeOptions by merging constructor options with per-call overrides.
   */
  private _buildServeOptions(overrides: APCoreMCPServeOptions = {}): ServeOptions {
    return {
      transport: overrides.transport,
      host: overrides.host,
      port: overrides.port,
      name: this._options.name,
      version: this._options.version,
      validateInputs: this._options.validateInputs,
      tags: this._options.tags,
      prefix: this._options.prefix,
      logLevel: this._options.logLevel,
      onStartup: overrides.onStartup,
      onShutdown: overrides.onShutdown,
      metricsCollector: this._options.metricsCollector,
      explorer: overrides.explorer,
      explorerPrefix: overrides.explorerPrefix,
      allowExecute: overrides.allowExecute,
      explorerTitle: overrides.explorerTitle,
      explorerProjectName: overrides.explorerProjectName,
      explorerProjectUrl: overrides.explorerProjectUrl,
      authenticator: this._options.authenticator,
      requireAuth: this._options.requireAuth,
      exemptPaths: this._options.exemptPaths,
      approvalHandler: this._options.approvalHandler,
      outputFormatter: this._options.outputFormatter,
      middleware: this._options.middleware,
      acl: this._options.acl,
    };
  }

  /**
   * Resolve the backend (handles extensions dir lazy init).
   */
  private async _resolveBackend(): Promise<RegistryOrExecutor> {
    if (this._backend !== null) return this._backend;

    if (!this._extensionsDir) {
      throw new Error("No backend configured");
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apcore = await import("apcore-js") as any;
      const RegistryClass = apcore.Registry ?? apcore.default?.Registry;
      if (!RegistryClass) {
        throw new Error("Cannot find Registry class in apcore-js");
      }
      const registry = new RegistryClass({ extensionsDir: this._extensionsDir });
      if (typeof registry.discover === "function") {
        await registry.discover();
      }
      this._registry = registry as Registry;
      this._backend = registry as RegistryOrExecutor;
      return registry;
    } catch (err) {
      throw new Error(
        `Failed to create Registry from extensions dir "${this._extensionsDir}". ` +
        `Ensure apcore-js is installed. Original error: ${err}`,
      );
    }
  }

  /**
   * Launch the MCP server (blocks until shutdown).
   *
   * @param options - Transport and lifecycle options.
   */
  async serve(options: APCoreMCPServeOptions = {}): Promise<void> {
    const backend = await this._resolveBackend();
    await serve(backend, this._buildServeOptions(options));
  }

  /**
   * Build an embeddable MCP HTTP request handler.
   *
   * Unlike `serve()`, this does NOT create its own HTTP server. Returns a
   * Node.js HTTP request handler and a close function.
   *
   * @param options - Embed options.
   * @returns Object with `handler` and `close()`.
   */
  async asyncServe(options: APCoreMCPAsyncServeOptions = {}): Promise<AsyncServeApp> {
    const backend = await this._resolveBackend();

    const asyncOpts: AsyncServeOptions = {
      name: this._options.name,
      version: this._options.version,
      validateInputs: this._options.validateInputs,
      tags: this._options.tags,
      prefix: this._options.prefix,
      logLevel: this._options.logLevel,
      metricsCollector: this._options.metricsCollector,
      explorer: options.explorer,
      explorerPrefix: options.explorerPrefix,
      allowExecute: options.allowExecute,
      explorerTitle: options.explorerTitle,
      explorerProjectName: options.explorerProjectName,
      explorerProjectUrl: options.explorerProjectUrl,
      authenticator: this._options.authenticator,
      requireAuth: this._options.requireAuth,
      exemptPaths: this._options.exemptPaths,
      approvalHandler: this._options.approvalHandler,
      endpoint: options.endpoint,
      outputFormatter: this._options.outputFormatter,
      middleware: this._options.middleware,
      acl: this._options.acl,
    };

    return asyncServe(backend, asyncOpts);
  }

  /**
   * Export modules as OpenAI-compatible tool definitions.
   *
   * @param options - Conversion options (embedAnnotations, strict).
   * @returns List of OpenAI tool definition dicts.
   */
  toOpenaiTools(options: ToOpenaiToolsOptions = {}): OpenAIToolDef[] {
    const reg = this.registry;
    return toOpenaiTools(reg, {
      ...options,
      tags: this._options.tags ?? undefined,
      prefix: this._options.prefix ?? undefined,
    });
  }
}
