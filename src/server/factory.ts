/**
 * MCPServerFactory - Creates and configures MCP Server instances.
 *
 * Responsible for:
 * - Creating low-level MCP Server instances with capabilities
 * - Building MCP Tool objects from apcore module descriptors
 * - Registering tools/list and tools/call request handlers
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Tool,
  TextContent,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { SchemaConverter } from "../adapters/schema.js";
import { AnnotationMapper } from "../adapters/annotations.js";
import type { Registry, ModuleDescriptor } from "../types.js";
import type { ExecutionRouter } from "./router.js";

/** Options for filtering when building tools from a registry. */
export interface BuildToolsOptions {
  tags?: string[] | null;
  prefix?: string | null;
}

export class MCPServerFactory {
  private readonly _schemaConverter: SchemaConverter;
  private readonly _annotationMapper: AnnotationMapper;

  constructor() {
    this._schemaConverter = new SchemaConverter();
    this._annotationMapper = new AnnotationMapper();
  }

  /**
   * Create a low-level MCP Server instance.
   *
   * @param name - Server name (default: "apcore-mcp")
   * @param version - Server version (default: "0.1.0")
   * @returns A configured Server instance with tools capability
   */
  createServer(
    name: string = "apcore-mcp",
    version: string = "0.1.0",
  ): Server {
    return new Server(
      { name, version },
      { capabilities: { tools: {} } },
    );
  }

  /**
   * Build an MCP Tool object from an apcore module descriptor.
   *
   * Maps descriptor fields to MCP Tool format:
   * - name = descriptor.module_id
   * - description = descriptor.description
   * - inputSchema = converted via SchemaConverter
   * - annotations = mapped from AnnotationMapper with camelCase keys
   */
  buildTool(descriptor: ModuleDescriptor): Tool {
    const mcpAnnotations = this._annotationMapper.toMcpAnnotations(
      descriptor.annotations,
    );

    const convertedSchema = this._schemaConverter.convertInputSchema(descriptor);

    const tool: Tool = {
      name: descriptor.module_id,
      description: descriptor.description,
      inputSchema: convertedSchema as Tool["inputSchema"],
      annotations: {
        readOnlyHint: mcpAnnotations.read_only_hint,
        destructiveHint: mcpAnnotations.destructive_hint,
        idempotentHint: mcpAnnotations.idempotent_hint,
        openWorldHint: mcpAnnotations.open_world_hint,
      },
    };

    return tool;
  }

  /**
   * Build an array of MCP Tool objects from all modules in a registry.
   *
   * Iterates over registry.list(), gets each definition, and builds tools.
   * Skips modules that return null definitions or throw errors (with console.warn).
   */
  buildTools(registry: Registry, options?: BuildToolsOptions): Tool[] {
    const tools: Tool[] = [];
    const moduleIds = registry.list({
      tags: options?.tags ?? null,
      prefix: options?.prefix ?? null,
    });

    for (const moduleId of moduleIds) {
      try {
        const descriptor = registry.get_definition(moduleId);
        if (descriptor === null) {
          console.warn(
            `Skipping module "${moduleId}": get_definition returned null`,
          );
          continue;
        }
        tools.push(this.buildTool(descriptor));
      } catch (error) {
        console.warn(
          `Skipping module "${moduleId}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return tools;
  }

  /**
   * Register tools/list and tools/call request handlers on a Server instance.
   *
   * @param server - The MCP Server to register handlers on
   * @param tools - Array of MCP Tool objects to serve
   * @param router - ExecutionRouter to handle tool call execution
   */
  registerHandlers(
    server: Server,
    tools: Tool[],
    router: ExecutionRouter,
  ): void {
    // Handle tools/list requests
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools };
    });

    // Handle tools/call requests
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const toolArgs = (args ?? {}) as Record<string, unknown>;

      const [content, isError] = await router.handleCall(name, toolArgs);

      if (isError) {
        throw new Error(content[0].text);
      }

      const result: CallToolResult = {
        content: content as TextContent[],
        isError: false,
      };

      return result;
    });
  }
}
