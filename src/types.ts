/**
 * Internal type definitions and type aliases for apcore-mcp.
 *
 * These types define the interfaces that apcore-mcp expects from the
 * apcore SDK. By using duck-typing interfaces rather than importing
 * concrete classes, we decouple from the apcore package at compile time.
 */

/** JSON Schema type alias */
export type JsonSchema = Record<string, unknown>;

/** Module annotations from apcore */
export interface ModuleAnnotations {
  readonly: boolean;
  destructive: boolean;
  idempotent: boolean;
  requires_approval: boolean;
  open_world: boolean;
}

/** Module descriptor from apcore */
export interface ModuleDescriptor {
  module_id: string;
  description: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  annotations: ModuleAnnotations | null;
  name?: string | null;
  documentation?: string | null;
  tags?: string[];
  version?: string;
  examples?: unknown[];
}

/** apcore Registry interface (duck-typed) */
export interface Registry {
  list(options?: { tags?: string[] | null; prefix?: string | null }): string[];
  get_definition(module_id: string): ModuleDescriptor | null;
  get(module_id: string): unknown | null;
  on(event: string, callback: (...args: unknown[]) => void): void;
  discover?(): number;
}

/** apcore Executor interface (duck-typed) */
export interface Executor {
  registry: Registry;
  call(module_id: string, inputs: Record<string, unknown>): Record<string, unknown>;
  call_async(module_id: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** Accept either Registry or Executor */
export type RegistryOrExecutor = Registry | Executor;

/** apcore ModuleError interface (duck-typed) */
export interface ModuleError extends Error {
  code: string;
  details: Record<string, unknown> | null;
}

/** MCP annotations dict returned by AnnotationMapper */
export interface McpAnnotationsDict {
  read_only_hint: boolean;
  destructive_hint: boolean;
  idempotent_hint: boolean;
  open_world_hint: boolean;
  title: string | null;
}

/** MCP error response from ErrorMapper */
export interface McpErrorResponse {
  is_error: true;
  error_type: string;
  message: string;
  details: Record<string, unknown> | null;
}

/** OpenAI tool definition */
export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
    strict?: boolean;
  };
}

/** Text content for MCP responses */
export interface TextContentDict {
  type: "text";
  text: string;
}
