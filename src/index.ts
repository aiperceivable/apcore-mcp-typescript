/**
 * apcore-mcp: Automatic MCP Server & OpenAI Tools Bridge for apcore.
 *
 * Public API:
 * - serve(registryOrExecutor, options?) - Launch an MCP Server
 * - toOpenaiTools(registryOrExecutor, options?) - Export OpenAI tool definitions
 */

import { OpenAIConverter } from "./converters/openai.js";
import type { ConvertRegistryOptions } from "./converters/openai.js";
import { MCPServerFactory } from "./server/factory.js";
import { ExecutionRouter } from "./server/router.js";
import { TransportManager } from "./server/transport.js";
import type {
  RegistryOrExecutor,
  Registry,
  Executor,
  OpenAIToolDef,
} from "./types.js";

export const VERSION = "0.1.0";

export type { Registry, Executor, RegistryOrExecutor, OpenAIToolDef } from "./types.js";
export type { ModuleDescriptor, ModuleAnnotations, JsonSchema } from "./types.js";

/**
 * Extract Registry from either a Registry or Executor instance.
 */
function resolveRegistry(registryOrExecutor: RegistryOrExecutor): Registry {
  if ("registry" in registryOrExecutor) {
    // It's an Executor — get its registry
    return (registryOrExecutor as Executor).registry;
  }
  // Assume it's a Registry
  return registryOrExecutor as Registry;
}

/**
 * Get or create an Executor from either a Registry or Executor instance.
 */
function resolveExecutor(registryOrExecutor: RegistryOrExecutor): Executor {
  if ("call_async" in registryOrExecutor) {
    // Already an Executor
    return registryOrExecutor as Executor;
  }
  // It's a Registry — the caller must provide an Executor
  // Since we don't import apcore directly, we create a minimal wrapper
  throw new Error(
    "serve() requires an Executor instance when not using a Registry with a built-in executor. " +
      "Please pass an Executor instead of a Registry.",
  );
}

/** Options for serve() */
export interface ServeOptions {
  /** Transport type. Default: "stdio" */
  transport?: "stdio" | "streamable-http" | "sse";
  /** Host address for HTTP-based transports. Default: "127.0.0.1" */
  host?: string;
  /** Port number for HTTP-based transports. Default: 8000 */
  port?: number;
  /** MCP server name. Default: "apcore-mcp" */
  name?: string;
  /** MCP server version. Default: package version */
  version?: string;
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
  } = options;

  const registry = resolveRegistry(registryOrExecutor);
  const executor = resolveExecutor(registryOrExecutor);

  // Build MCP server components
  const factory = new MCPServerFactory();
  const server = factory.createServer(name, version);
  const tools = factory.buildTools(registry);
  const router = new ExecutionRouter(executor);
  factory.registerHandlers(server, tools, router);

  console.info(
    `Starting MCP server '${name}' v${version} with ${tools.length} tools via ${transport}`,
  );

  // Select and run transport
  const transportManager = new TransportManager();

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
}

/** Options for toOpenaiTools() */
export interface ToOpenaiToolsOptions extends ConvertRegistryOptions {}

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
