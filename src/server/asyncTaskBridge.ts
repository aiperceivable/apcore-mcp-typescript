/**
 * AsyncTaskBridge — MCP ↔ apcore `AsyncTaskManager` adapter.
 *
 * Surfaces apcore's {@link AsyncTaskManager} through the MCP protocol so
 * that long-running modules can be submitted, polled, cancelled, and listed
 * via reserved meta-tools. Async-hinted modules (either
 * `metadata.async === true` OR `annotations.extra["mcp_async"] === "true"`)
 * are routed through `AsyncTaskManager.submit()` instead of the synchronous
 * executor call path; the agent receives a `{task_id, status: "pending"}`
 * envelope it can resolve via the four reserved `__apcore_task_*` meta-tools.
 *
 * Full spec: apcore-mcp/docs/features/async-task-bridge.md (F-043).
 */

import type { ModuleDescriptor } from "../types.js";

/** Reserved meta-tool prefix. Module ids starting with this are forbidden. */
export const APCORE_META_TOOL_PREFIX = "__apcore_";

/** The four reserved meta-tool names. */
export const META_TOOL_NAMES = Object.freeze({
  SUBMIT: "__apcore_task_submit",
  STATUS: "__apcore_task_status",
  CANCEL: "__apcore_task_cancel",
  LIST: "__apcore_task_list",
} as const);

/** Duck-typed TaskInfo projection matching apcore-js `TaskInfo`. */
export interface TaskInfoProjection {
  task_id: string;
  module_id: string;
  status: string;
  submitted_at: number;
  started_at: number | null;
  completed_at: number | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

/** Minimal duck-typed `AsyncTaskManager` contract the bridge depends on. */
export interface AsyncTaskManagerLike {
  submit(
    moduleId: string,
    inputs: Record<string, unknown>,
    context?: unknown | null,
  ): Promise<string>;
  getStatus(taskId: string): {
    taskId: string;
    moduleId: string;
    status: string;
    submittedAt: number;
    startedAt: number | null;
    completedAt: number | null;
    result: Record<string, unknown> | null;
    error: string | null;
  } | null;
  getResult(taskId: string): Record<string, unknown>;
  cancel(taskId: string): Promise<boolean>;
  listTasks(status?: string): Array<{
    taskId: string;
    moduleId: string;
    status: string;
    submittedAt: number;
    startedAt: number | null;
    completedAt: number | null;
    result: Record<string, unknown> | null;
    error: string | null;
  }>;
  shutdown?(): Promise<void>;
}

/** MCP-facing Tool shape used to advertise meta-tools. */
export interface AsyncMetaTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Options for {@link AsyncTaskBridge}. */
export interface AsyncTaskBridgeOptions {
  /** When false, `isAsyncModule()` always returns false — meta-tools are disabled. */
  enabled?: boolean;
  /**
   * Optional output-redactor invoked on completed task results before they are
   * returned from `__apcore_task_status`. Signature matches apcore-js's
   * `redactSensitive(result, outputSchema)`.
   */
  redactSensitive?: (
    result: Record<string, unknown>,
    outputSchema: Record<string, unknown>,
  ) => Record<string, unknown>;
  /** Map of module_id → output_schema used by `redactSensitive`. */
  outputSchemaMap?: Record<string, Record<string, unknown>>;
  /**
   * Look up a module's descriptor by id. Used by `__apcore_task_submit` to
   * enforce the spec rule "non-async module → ASYNC_MODULE_NOT_ASYNC".
   * When omitted, the rule is skipped (preserves backwards-compatible
   * behavior for tests / direct construction without a registry). [A-D-008]
   */
  descriptorLookup?: (moduleId: string) => ModuleDescriptor | null | undefined;
}

/**
 * Routes MCP tool calls either to the synchronous Execution Router (default)
 * or to `AsyncTaskManager.submit()` for async-hinted modules.
 */
export class AsyncTaskBridge {
  private readonly _manager: AsyncTaskManagerLike;
  private readonly _enabled: boolean;
  private readonly _redactSensitive?: AsyncTaskBridgeOptions["redactSensitive"];
  private readonly _outputSchemaMap: Record<string, Record<string, unknown>>;
  private readonly _descriptorLookup?: AsyncTaskBridgeOptions["descriptorLookup"];

  constructor(manager: AsyncTaskManagerLike, options?: AsyncTaskBridgeOptions) {
    this._manager = manager;
    this._enabled = options?.enabled ?? true;
    this._redactSensitive = options?.redactSensitive;
    this._outputSchemaMap = options?.outputSchemaMap ?? {};
    this._descriptorLookup = options?.descriptorLookup;
  }

  /** Whether async routing and meta-tools are enabled. */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Expose the underlying manager (used by server lifecycle for shutdown). */
  get manager(): AsyncTaskManagerLike {
    return this._manager;
  }

  /**
   * Return true if the descriptor carries an async hint — either
   * `metadata.async === true` OR `annotations.extra["mcp_async"] === "true"`.
   */
  isAsyncModule(descriptor: ModuleDescriptor | null | undefined): boolean {
    if (!this._enabled || !descriptor) return false;
    const meta = descriptor.metadata ?? {};
    if (meta["async"] === true) return true;
    const annotations = descriptor.annotations;
    if (annotations?.extra) {
      const flag = annotations.extra["mcp_async"];
      if (flag === true || flag === "true") return true;
    }
    return false;
  }

  /**
   * Submit a module invocation to the AsyncTaskManager. Returns the standard
   * MCP envelope `{task_id, status: "pending"}`.
   */
  async submit(
    moduleId: string,
    inputs: Record<string, unknown>,
    context?: unknown | null,
  ): Promise<{ task_id: string; status: "pending" }> {
    const taskId = await this._manager.submit(moduleId, inputs, context ?? null);
    return { task_id: taskId, status: "pending" };
  }

  /**
   * Build the four MCP meta-tool definitions. Caller merges these with
   * the regular tool list returned by `tools/list`.
   */
  buildMetaTools(): AsyncMetaTool[] {
    if (!this._enabled) return [];
    return [
      {
        name: META_TOOL_NAMES.SUBMIT,
        description:
          "Submit an async-hinted apcore module for background execution. " +
          "Returns `{task_id, status: \"pending\"}`. Use `__apcore_task_status` " +
          "to poll until terminal state.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            module_id: { type: "string" },
            arguments: { type: "object", additionalProperties: true, default: {} },
            version_hint: { type: "string" },
          },
          required: ["module_id"],
        },
      },
      {
        name: META_TOOL_NAMES.STATUS,
        description:
          "Return the TaskInfo projection for a previously submitted async " +
          "task. When the task is `completed`, the redacted result is inlined.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { task_id: { type: "string" } },
          required: ["task_id"],
        },
      },
      {
        name: META_TOOL_NAMES.CANCEL,
        description:
          "Cooperatively cancel a pending or running async task. Returns " +
          "`{task_id, cancelled: bool}`.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { task_id: { type: "string" } },
          required: ["task_id"],
        },
      },
      {
        name: META_TOOL_NAMES.LIST,
        description:
          "List tracked async tasks. Optional `status` filter narrows to a " +
          "single lifecycle state.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              type: "string",
              enum: ["pending", "running", "completed", "failed", "cancelled"],
            },
          },
        },
      },
    ];
  }

  /**
   * Whether `toolName` is one of the reserved meta-tools. Used by the
   * execution router to short-circuit dispatch before touching the executor.
   */
  isMetaTool(toolName: string): boolean {
    return (
      this._enabled &&
      (toolName === META_TOOL_NAMES.SUBMIT ||
        toolName === META_TOOL_NAMES.STATUS ||
        toolName === META_TOOL_NAMES.CANCEL ||
        toolName === META_TOOL_NAMES.LIST)
    );
  }

  /**
   * Dispatch a meta-tool invocation. The caller must have already confirmed
   * `isMetaTool(toolName)` is true.
   */
  async handleMetaTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: unknown | null,
  ): Promise<Record<string, unknown>> {
    switch (toolName) {
      case META_TOOL_NAMES.SUBMIT: {
        const moduleId = args["module_id"];
        if (typeof moduleId !== "string" || moduleId.length === 0) {
          throw new Error("__apcore_task_submit requires module_id (string)");
        }
        if (moduleId.startsWith(APCORE_META_TOOL_PREFIX)) {
          throw new Error(
            `Reserved module id: "${moduleId}". Ids prefixed with ` +
              `"${APCORE_META_TOOL_PREFIX}" are reserved for apcore-mcp meta-tools.`,
          );
        }
        // Spec: __apcore_task_submit on a non-async module returns
        // ASYNC_MODULE_NOT_ASYNC. Python enforces; TS+Rust were silently
        // wrapping sync modules as async tasks. The check is only applied
        // when a descriptor-lookup callback is wired (the normal
        // production path); direct test construction without a registry
        // skips this guard to preserve unit-test ergonomics. [A-D-008]
        if (this._descriptorLookup) {
          const descriptor = this._descriptorLookup(moduleId);
          if (!descriptor || !this.isAsyncModule(descriptor)) {
            const err = new Error(
              `ASYNC_MODULE_NOT_ASYNC: module "${moduleId}" is not async-hinted; ` +
                `use regular tools/call instead of __apcore_task_submit`,
            );
            (err as Error & { code?: string }).code = "ASYNC_MODULE_NOT_ASYNC";
            throw err;
          }
        }
        const inputs =
          (args["arguments"] as Record<string, unknown> | undefined) ?? {};
        return this.submit(moduleId, inputs, context);
      }
      case META_TOOL_NAMES.STATUS: {
        const taskId = args["task_id"];
        if (typeof taskId !== "string" || taskId.length === 0) {
          throw new Error("__apcore_task_status requires task_id (string)");
        }
        const info = this._manager.getStatus(taskId);
        if (!info) {
          const err = new Error(`Task not found: ${taskId}`);
          (err as Error & { code?: string }).code = "ASYNC_TASK_NOT_FOUND";
          throw err;
        }
        const projection = this._projectTaskInfo(info);
        // Inline completed result after redaction.
        if (info.status === "completed" && info.result) {
          const schema = this._outputSchemaMap[info.moduleId];
          const redacted = this._redactSensitive && schema
            ? this._redactSensitive(info.result, schema)
            : info.result;
          projection.result = redacted;
        } else if (info.status === "failed" && info.error) {
          projection.error = info.error;
        }
        return projection as unknown as Record<string, unknown>;
      }
      case META_TOOL_NAMES.CANCEL: {
        const taskId = args["task_id"];
        if (typeof taskId !== "string" || taskId.length === 0) {
          throw new Error("__apcore_task_cancel requires task_id (string)");
        }
        const cancelled = await this._manager.cancel(taskId);
        return { task_id: taskId, cancelled };
      }
      case META_TOOL_NAMES.LIST: {
        const status = args["status"];
        const filter = typeof status === "string" ? status : undefined;
        const tasks = this._manager.listTasks(filter);
        return { tasks: tasks.map((t) => this._projectTaskInfo(t)) };
      }
      default:
        throw new Error(`Unknown meta-tool: ${toolName}`);
    }
  }

  private _projectTaskInfo(info: {
    taskId: string;
    moduleId: string;
    status: string;
    submittedAt: number;
    startedAt: number | null;
    completedAt: number | null;
    result: Record<string, unknown> | null;
    error: string | null;
  }): TaskInfoProjection {
    return {
      task_id: info.taskId,
      module_id: info.moduleId,
      status: info.status,
      submitted_at: info.submittedAt,
      started_at: info.startedAt,
      completed_at: info.completedAt,
    };
  }
}

/**
 * Factory that dynamically imports apcore-js's `AsyncTaskManager` and wraps
 * it in an `AsyncTaskBridge`. Returns null when apcore-js is unavailable.
 */
export async function createAsyncTaskBridge(
  executor: unknown,
  options?: {
    enabled?: boolean;
    maxConcurrent?: number;
    maxTasks?: number;
    outputSchemaMap?: Record<string, Record<string, unknown>>;
    /**
     * Optional descriptor lookup (typically `(id) => registry.getDefinition(id)`).
     * When provided, `__apcore_task_submit` enforces the spec's
     * ASYNC_MODULE_NOT_ASYNC rule. [A-D-008]
     */
    descriptorLookup?: (moduleId: string) => ModuleDescriptor | null | undefined;
  },
): Promise<AsyncTaskBridge | null> {
  if (options?.enabled === false) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apcore = (await import("apcore-js")) as any;
    const AsyncTaskManager = apcore.AsyncTaskManager ?? apcore.default?.AsyncTaskManager;
    if (!AsyncTaskManager) return null;
    const manager = new AsyncTaskManager(
      executor,
      options?.maxConcurrent ?? 10,
      options?.maxTasks ?? 1000,
    ) as AsyncTaskManagerLike;
    const redactSensitive = apcore.redactSensitive ?? apcore.default?.redactSensitive;
    return new AsyncTaskBridge(manager, {
      enabled: true,
      redactSensitive: typeof redactSensitive === "function" ? redactSensitive : undefined,
      outputSchemaMap: options?.outputSchemaMap,
      descriptorLookup: options?.descriptorLookup,
    });
  } catch {
    return null;
  }
}
