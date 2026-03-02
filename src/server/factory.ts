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
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Tool,
  CallToolResult,
  Resource,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";

import { SchemaConverter } from "../adapters/schema.js";
import { AnnotationMapper } from "../adapters/annotations.js";
import type { Registry, ModuleDescriptor } from "../types.js";
import type { ExecutionRouter } from "./router.js";
import type { HandleCallExtra } from "./router.js";

/** Metadata keys for AI intent annotations appended to tool descriptions. */
const AI_INTENT_KEYS = ["x-when-to-use", "x-when-not-to-use", "x-common-mistakes", "x-workflow-hints"] as const;

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
      { capabilities: { tools: {}, resources: {} } },
    );
  }

  /**
   * Build an MCP Tool object from an apcore module descriptor.
   *
   * Maps descriptor fields to MCP Tool format:
   * - name = descriptor.moduleId
   * - description = descriptor.description
   * - inputSchema = converted via SchemaConverter
   * - annotations = mapped from AnnotationMapper with camelCase keys
   */
  buildTool(descriptor: ModuleDescriptor): Tool {
    if (!descriptor.moduleId || typeof descriptor.moduleId !== "string") {
      throw new Error("ModuleDescriptor.moduleId is required and must be a string");
    }
    if (descriptor.description !== undefined && descriptor.description !== null && typeof descriptor.description !== "string") {
      throw new Error("ModuleDescriptor.description must be a string");
    }

    // NOTE: TypeScript uses AnnotationMapper.toMcpAnnotations() directly,
    // while Python uses SchemaExporter.export_mcp() for the same mapping.
    // Both produce identical output. If annotation logic changes, update both paths.
    const mcpAnnotations = this._annotationMapper.toMcpAnnotations(
      descriptor.annotations,
    );

    const convertedSchema = this._schemaConverter.convertInputSchema(descriptor);

    const hasApproval = this._annotationMapper.hasRequiresApproval(descriptor.annotations);

    // Append AI intent metadata to description for agent visibility
    let description = descriptor.description;
    const metadata = descriptor.metadata ?? {};
    const intentParts: string[] = [];
    for (const key of AI_INTENT_KEYS) {
      const val = metadata[key];
      if (val && typeof val === "string") {
        const label = key.replace("x-", "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        intentParts.push(`${label}: ${val}`);
      }
    }
    if (intentParts.length > 0) {
      description += "\n\n" + intentParts.join("\n");
    }

    const tool: Tool = {
      name: descriptor.moduleId,
      description,
      inputSchema: convertedSchema as Tool["inputSchema"],
      annotations: {
        readOnlyHint: mcpAnnotations.readOnlyHint,
        destructiveHint: mcpAnnotations.destructiveHint,
        idempotentHint: mcpAnnotations.idempotentHint,
        openWorldHint: mcpAnnotations.openWorldHint,
      },
    };

    const hasStreaming = descriptor.annotations?.streaming === true;

    if (hasApproval || hasStreaming) {
      const meta: Record<string, unknown> = {};
      if (hasApproval) {
        meta.requiresApproval = true;
      }
      if (hasStreaming) {
        meta.streaming = true;
      }
      (tool as Tool & { _meta?: Record<string, unknown> })._meta = meta;
    }

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
        const descriptor = registry.getDefinition(moduleId);
        if (descriptor === null) {
          console.warn(
            `Skipping module "${moduleId}": getDefinition returned null`,
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
   * Register resources/list and resources/read handlers for modules with documentation.
   *
   * Iterates over registry.list(), gets each definition, and filters for
   * descriptors that have a non-null `documentation` field. Registers:
   * - resources/list: returns Resource objects with URI docs://{module_id}
   * - resources/read: returns documentation text for the requested module
   *
   * @param server - The MCP Server to register handlers on
   * @param registry - Registry to discover modules with documentation
   */
  registerResourceHandlers(
    server: Server,
    registry: Registry,
  ): void {
    // Build a map of module_id -> documentation for modules with docs
    const docsMap = new Map<string, string>();
    const moduleIds = registry.list();

    for (const moduleId of moduleIds) {
      try {
        const descriptor = registry.getDefinition(moduleId);
        if (descriptor?.documentation) {
          docsMap.set(moduleId, descriptor.documentation);
        }
      } catch {
        // Skip modules that throw errors
      }
    }

    // Handle resources/list requests
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources: Resource[] = [];
      for (const [moduleId, _doc] of docsMap) {
        resources.push({
          uri: `docs://${moduleId}`,
          name: `${moduleId} documentation`,
          mimeType: "text/plain",
        });
      }
      return { resources };
    });

    // Handle resources/read requests
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const prefix = "docs://";
      if (!uri.startsWith(prefix)) {
        throw new Error(`Unsupported URI scheme: ${uri}`);
      }
      const moduleId = uri.slice(prefix.length);
      const documentation = docsMap.get(moduleId);
      if (documentation === undefined) {
        throw new Error(`Resource not found: ${uri}`);
      }
      const result: ReadResourceResult = {
        contents: [
          {
            uri,
            text: documentation,
            mimeType: "text/plain",
          },
        ],
      };
      return result;
    });
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
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;
      const toolArgs = (args ?? {}) as Record<string, unknown>;

      // Build HandleCallExtra from MCP SDK extra
      const handleCallExtra: HandleCallExtra = {
        sendNotification: extra?.sendNotification
          ? (notification: Record<string, unknown>) =>
              extra.sendNotification(notification as any)
          : undefined,
        sendRequest: extra?.sendRequest
          ? (request: Record<string, unknown>, resultSchema: unknown) =>
              (extra.sendRequest as Function)(request, resultSchema)
          : undefined,
        _meta: extra?._meta
          ? { progressToken: extra._meta.progressToken }
          : undefined,
      };

      const [content, isError, _traceId] = await router.handleCall(
        name,
        toolArgs,
        handleCallExtra,
      );

      const textContents = content.map(c => ({ type: "text" as const, text: c.text }));

      // NOTE: The MCP SDK decorator always wraps our return in
      // CallToolResult(isError=false). Setting isError=true is not
      // supported by the current SDK decorator. For errors, we raise
      // so the SDK sets isError=true on the CallToolResult.
      if (isError) {
        throw new Error(textContents[0]?.text ?? "Unknown error");
      }

      const result: CallToolResult = {
        content: textContents,
      };

      return result;
    });
  }
}
