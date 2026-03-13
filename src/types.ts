/**
 * APCore MCP Bridge — Type Definitions
 *
 * All interfaces use camelCase to match apcore-typescript conventions.
 * The protocol spec uses snake_case as canonical; this file maps to TypeScript idioms.
 */

// ─── Type Aliases ────────────────────────────────────────────────────────────

export type JsonSchema = Record<string, unknown>;
export type RegistryOrExecutor = Registry | Executor;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Standard registry event names. */
export const REGISTRY_EVENTS = Object.freeze({
  REGISTER: "register",
  UNREGISTER: "unregister",
} as const);

/** Framework error codes used by ErrorMapper. */
export const ErrorCodes = Object.freeze({
  MODULE_NOT_FOUND: "MODULE_NOT_FOUND",
  SCHEMA_VALIDATION_ERROR: "SCHEMA_VALIDATION_ERROR",
  ACL_DENIED: "ACL_DENIED",
  CALL_DEPTH_EXCEEDED: "CALL_DEPTH_EXCEEDED",
  CIRCULAR_CALL: "CIRCULAR_CALL",
  CALL_FREQUENCY_EXCEEDED: "CALL_FREQUENCY_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  MODULE_TIMEOUT: "MODULE_TIMEOUT",
  MODULE_LOAD_ERROR: "MODULE_LOAD_ERROR",
  MODULE_EXECUTE_ERROR: "MODULE_EXECUTE_ERROR",
  GENERAL_INVALID_INPUT: "GENERAL_INVALID_INPUT",
  APPROVAL_DENIED: "APPROVAL_DENIED",
  APPROVAL_TIMEOUT: "APPROVAL_TIMEOUT",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  VERSION_INCOMPATIBLE: "VERSION_INCOMPATIBLE",
  ERROR_CODE_COLLISION: "ERROR_CODE_COLLISION",
  EXECUTION_CANCELLED: "EXECUTION_CANCELLED",
} as const);

/** Valid module ID pattern. No hyphens allowed. */
export const MODULE_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

// ─── Module Types ────────────────────────────────────────────────────────────

export interface ModuleAnnotations {
  readonly: boolean;
  destructive: boolean;
  idempotent: boolean;
  requiresApproval: boolean;
  openWorld: boolean;
  streaming: boolean;
  cacheable?: boolean;
  cacheTtl?: number;
  cacheKeyFields?: string[] | null;
  paginated?: boolean;
  paginationStyle?: "cursor" | "offset" | "page";
}

export interface ModuleDescriptor {
  moduleId: string;
  name?: string | null;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: ModuleAnnotations | null;
  documentation?: string | null;
  tags?: string[];
  version?: string;
  examples?: unknown[];
  metadata?: Record<string, unknown>;
}

// ─── Core Interfaces (duck-typed for apcore-typescript compatibility) ────────

export interface Registry {
  list(options?: { tags?: string[] | null; prefix?: string | null }): string[];
  getDefinition(moduleId: string): ModuleDescriptor | null;
  has?(moduleId: string): boolean;
  on(event: string, callback: (...args: unknown[]) => void): void;
  discover?(): Promise<number>;
}

export interface Executor {
  registry: Registry;
  call(moduleId: string, inputs: Record<string, unknown>, context?: unknown): Promise<Record<string, unknown>>;
  callAsync?(moduleId: string, inputs: Record<string, unknown>, context?: unknown): Promise<Record<string, unknown>>;
  stream?(moduleId: string, inputs: Record<string, unknown>, context?: unknown): AsyncIterable<Record<string, unknown>>;
  validate?(toolName: string, args: Record<string, unknown>): unknown | Promise<unknown>;
}

// ─── Error Type ──────────────────────────────────────────────────────────────

export interface ModuleError extends Error {
  code: string;
  details: Record<string, unknown> | null;
}

// ─── MCP Types ───────────────────────────────────────────────────────────────

export interface McpAnnotationsDict {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
  title: string | null;
}

export interface McpErrorResponse {
  isError: true;
  errorType: string;
  message: string;
  details: Record<string, unknown> | null;
  retryable?: boolean;
  aiGuidance?: string;
  userFixable?: boolean;
  suggestion?: string;
}

// ─── OpenAI Types ────────────────────────────────────────────────────────────

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
    strict?: boolean;
  };
}

// ─── Utility Types ───────────────────────────────────────────────────────────

export interface TextContentDict {
  type: "text";
  text: string;
}
