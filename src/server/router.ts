/**
 * ExecutionRouter - Routes MCP tool calls to apcore module execution.
 *
 * Bridges the MCP tools/call protocol with apcore's Executor.call() or callAsync(),
 * handling success/error formatting for MCP text content responses.
 *
 * When the executor supports stream() and the caller provides a progressToken,
 * chunks are forwarded as MCP notifications/progress before returning the
 * accumulated result.
 */

import { ErrorMapper } from "../adapters/errors.js";
import type { Executor, TextContentDict, McpErrorResponse } from "../types.js";
import { createBridgeContext } from "./context.js";
import { MCP_PROGRESS_KEY, MCP_ELICIT_KEY } from "../helpers.js";
import type { ElicitResult } from "../helpers.js";
import { getCurrentIdentity } from "../auth/storage.js";

/** Maximum recursion depth for deep merge to prevent stack overflow. */
const DEEP_MERGE_MAX_DEPTH = 32;

/**
 * Recursively merge `overlay` into `base`, capped at DEEP_MERGE_MAX_DEPTH.
 *
 * When both sides have a plain object for the same key the merge recurses.
 * All other types are overwritten by `overlay`.
 */
function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth >= DEEP_MERGE_MAX_DEPTH) {
    return { ...base, ...overlay };
  }
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const bVal = merged[key];
    const oVal = overlay[key];
    if (
      bVal !== null && typeof bVal === "object" && !Array.isArray(bVal) &&
      oVal !== null && typeof oVal === "object" && !Array.isArray(oVal)
    ) {
      merged[key] = deepMerge(
        bVal as Record<string, unknown>,
        oVal as Record<string, unknown>,
        depth + 1,
      );
    } else {
      merged[key] = oVal;
    }
  }
  return merged;
}

/** Tuple of [content array, isError flag, traceId] returned from handleCall. */
export type CallResult = [TextContentDict[], boolean, string | undefined];

/**
 * Extra context passed from the MCP SDK request handler.
 *
 * Mirrors the relevant subset of the SDK's `RequestHandlerExtra`:
 * - `sendNotification` — sends an out-of-band notification on the current session
 * - `sendRequest` — sends a request to the client (used for elicitation)
 * - `_meta.progressToken` — opaque token the client attached to the request
 */
export interface HandleCallExtra {
  sendNotification?: (notification: Record<string, unknown>) => Promise<void>;
  sendRequest?: (request: Record<string, unknown>, resultSchema: unknown) => Promise<unknown>;
  _meta?: { progressToken?: string | number; apcore?: { version?: string } };
  versionHint?: string;
}

/** Options for the ExecutionRouter constructor. */
export interface ExecutionRouterOptions {
  validateInputs?: boolean;
  /**
   * Optional function that formats execution results into text for LLM consumption.
   * When undefined, results are serialised with `JSON.stringify(result)`.
   * Only applied to plain-object results; non-object results always use JSON.stringify.
   */
  outputFormatter?: (result: Record<string, unknown>) => string;
  /**
   * When true (default), redact sensitive fields from output using apcore's
   * `redactSensitive()` before formatting. Requires apcore-js to be installed
   * and the tool to have an output_schema in `outputSchemaMap`.
   */
  redactOutput?: boolean;
  /**
   * When true, use callWithTrace() (if available on the executor) to include
   * pipeline trace metadata in the response `_meta.trace`. Default: false.
   */
  trace?: boolean;
  /**
   * Map of module_id to output_schema, used by redactSensitive() to identify
   * which fields should be redacted.
   */
  outputSchemaMap?: Record<string, Record<string, unknown>>;
}

export class ExecutionRouter {
  private readonly _executor: Executor;
  private readonly _errorMapper: ErrorMapper;
  private readonly _validateInputs: boolean;
  private readonly _outputFormatter?: (result: Record<string, unknown>) => string;
  private readonly _redactOutput: boolean;
  private readonly _outputSchemaMap: Record<string, Record<string, unknown>>;
  private readonly _trace: boolean;

  /**
   * Create an ExecutionRouter.
   *
   * @param executor - Duck-typed executor with call(moduleId, inputs) or callAsync(moduleId, inputs)
   * @param options - Optional configuration including validateInputs and outputFormatter
   */
  constructor(executor: Executor, options?: ExecutionRouterOptions) {
    this._executor = executor;
    this._errorMapper = new ErrorMapper();
    this._validateInputs = options?.validateInputs ?? false;
    this._outputFormatter = options?.outputFormatter;
    this._redactOutput = options?.redactOutput ?? true;
    this._outputSchemaMap = options?.outputSchemaMap ?? {};
    this._trace = options?.trace ?? false;
  }

  /**
   * Attempt to redact sensitive fields from the result using apcore's redactSensitive().
   *
   * Returns the original result if apcore-js is not available, redactSensitive is not
   * exported, or if an error occurs during redaction.
   */
  private async _maybeRedact(
    toolName: string,
    result: unknown,
  ): Promise<unknown> {
    if (!this._redactOutput) return result;
    const outputSchema = this._outputSchemaMap[toolName];
    if (!outputSchema) return result;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apcore = await import("apcore-js") as any;
      const redactSensitive = apcore.redactSensitive ?? apcore.default?.redactSensitive;
      if (typeof redactSensitive !== "function") {
        console.debug(
          `redactSensitive not available in apcore-js, skipping redaction for "${toolName}"`,
        );
        return result;
      }
      return redactSensitive(result, outputSchema);
    } catch (err: unknown) {
      console.warn(
        `redactSensitive failed for "${toolName}", returning unredacted result: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return result;
    }
  }

  /**
   * Format an execution result into text for LLM consumption.
   *
   * Uses the configured outputFormatter if set, otherwise falls back
   * to `JSON.stringify(result)`. The formatter is only applied to
   * plain-object results.
   */
  private _formatResult(result: unknown): string {
    if (
      this._outputFormatter &&
      result !== null &&
      typeof result === "object" &&
      !Array.isArray(result)
    ) {
      try {
        return this._outputFormatter(result as Record<string, unknown>);
      } catch {
        // outputFormatter failed — fall back to JSON.stringify
      }
    }
    return JSON.stringify(result);
  }

  /**
   * Build error text content, appending AI guidance fields as structured JSON when present.
   *
   * Guidance keys use camelCase (aiGuidance, userFixable) — identical across Python and TypeScript.
   */
  private static _buildErrorText(errorInfo: McpErrorResponse): string {
    let text = errorInfo.message;
    const guidance: Record<string, unknown> = {};
    if (errorInfo.retryable !== undefined) guidance.retryable = errorInfo.retryable;
    if (errorInfo.aiGuidance !== undefined) guidance.aiGuidance = errorInfo.aiGuidance;
    if (errorInfo.userFixable !== undefined) guidance.userFixable = errorInfo.userFixable;
    if (errorInfo.suggestion !== undefined) guidance.suggestion = errorInfo.suggestion;
    if (Object.keys(guidance).length > 0) {
      text += "\n\n" + JSON.stringify(guidance);
    }
    return text;
  }

  /**
   * Handle an MCP tools/call request by routing to the executor.
   *
   * Streaming path: if the executor has stream(), a progressToken is present,
   * and sendNotification is available, each chunk from stream() is forwarded as
   * a `notifications/progress` notification. The chunks are shallow-merged into
   * an accumulated result which is returned as the final response.
   *
   * Non-streaming path: tries executor.call() first, then falls back to
   * executor.callAsync().
   *
   * @param toolName - The MCP tool name (maps to apcore moduleId)
   * @param args - The tool call arguments
   * @param extra - Optional MCP SDK extra context with sendNotification and _meta
   * @returns Tuple of [content, isError, traceId] where content is an array of text content dicts
   */
  async handleCall(
    toolName: string,
    args: Record<string, unknown>,
    extra?: HandleCallExtra,
  ): Promise<CallResult> {
    try {
      // ── Build context with MCP callbacks ──────────────────────────────
      const progressToken = extra?._meta?.progressToken;
      const sendNotification = extra?.sendNotification;
      const sendRequest = extra?.sendRequest;

      const contextData: Record<string, unknown> = {};
      let hasCallbacks = false;

      // Inject progress callback if progressToken + sendNotification available
      if (progressToken !== undefined && sendNotification) {
        hasCallbacks = true;
        contextData[MCP_PROGRESS_KEY] = async (
          progress: number,
          total?: number,
          message?: string,
        ): Promise<void> => {
          await sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress,
              total: total ?? 0,
              ...(message !== undefined ? { message } : {}),
            },
          });
        };
      }

      // Inject elicitation callback if sendRequest available
      if (sendRequest) {
        hasCallbacks = true;
        contextData[MCP_ELICIT_KEY] = async (
          message: string,
          requestedSchema?: Record<string, unknown>,
        ): Promise<ElicitResult | null> => {
          const result = await sendRequest(
            {
              method: "elicitation/create",
              params: {
                message,
                ...(requestedSchema ? { requestedSchema } : {}),
              },
            },
            {},
          );
          return (result as ElicitResult) ?? null;
        };
      }

      const identity = getCurrentIdentity();

      const context = (hasCallbacks || identity)
        ? createBridgeContext(contextData, identity)
        : undefined;

      // ── Pre-execution validation ────────────────────────────────────
      if (this._validateInputs && this._executor.validate) {
        try {
          const rawErrors = await this._executor.validate(toolName, args);
          let errorMessages: string[] = [];
          if (Array.isArray(rawErrors)) {
            // Handle both string[] and ValidationResult.errors (array of objects)
            errorMessages = rawErrors.map((e: unknown) => {
              if (typeof e === 'string') return e;
              if (typeof e === 'object' && e !== null) {
                const obj = e as Record<string, unknown>;
                const field = obj.field ?? obj.path ?? '?';
                const msg = obj.message ?? 'invalid';
                return `${field}: ${msg}`;
              }
              return String(e);
            });
          } else if (rawErrors && typeof rawErrors === 'object' && 'valid' in (rawErrors as object)) {
            // Handle ValidationResult object
            const vr = rawErrors as { valid: boolean; errors: Array<{ field?: string; message?: string }> };
            if (!vr.valid) {
              errorMessages = vr.errors.map(e => `${e.field ?? '?'}: ${e.message ?? 'invalid'}`);
            }
          }
          if (errorMessages.length > 0) {
            const detail = errorMessages.join("; ");
            const content: TextContentDict[] = [
              { type: "text", text: `Validation failed: ${detail}` },
            ];
            return [content, true, undefined];
          }
        } catch (valError: unknown) {
          const errorInfo = this._errorMapper.toMcpError(valError);
          const content: TextContentDict[] = [
            { type: "text", text: ExecutionRouter._buildErrorText(errorInfo) },
          ];
          return [content, true, undefined];
        }
      }

      // ── Resolve versionHint from request metadata or descriptor ──────
      let versionHint: string | undefined = extra?.versionHint
        ?? extra?._meta?.apcore?.version;
      if (!versionHint) {
        try {
          const descriptor = this._executor.registry?.getDefinition?.(toolName);
          const metaHint = descriptor?.metadata?.versionHint;
          if (typeof metaHint === "string") {
            versionHint = metaHint;
          }
        } catch {
          // ignore — registry lookup is best-effort
        }
      }

      // ── Streaming path ────────────────────────────────────────────────
      if (
        this._executor.stream &&
        progressToken !== undefined &&
        sendNotification
      ) {
        let accumulated: Record<string, unknown> = {};
        let chunkIndex = 0;

        // TODO(apcore>=0.19): streaming traces via streamWithTrace
        for await (const chunk of this._executor.stream(toolName, args, context, versionHint)) {
          // Deep-merge each chunk into the accumulated result
          accumulated = deepMerge(accumulated, chunk);

          // Send progress notification for each chunk
          await sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: chunkIndex + 1,
              message: JSON.stringify(chunk),
            },
          });

          chunkIndex++;
        }

        const redacted = await this._maybeRedact(toolName, accumulated);

        const content: TextContentDict[] = [
          {
            type: "text",
            text: this._formatResult(redacted),
          },
        ];

        const traceId = context?.traceId;
        return [content, false, traceId];
      }

      // ── Non-streaming path ────────────────────────────────────────────
      let result: Record<string, unknown>;
      let traceMeta: Record<string, unknown> | undefined;

      if (this._trace && typeof this._executor.callWithTrace === 'function') {
        const [traceResult, pipelineTrace] = await this._executor.callWithTrace(toolName, args, context, versionHint);
        result = traceResult;
        // Convert pipeline trace to a serialisable dict
        if (pipelineTrace && typeof pipelineTrace === 'object') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pt = pipelineTrace as any;
          traceMeta = {
            strategyName: pt.strategyName ?? pt.strategy_name ?? undefined,
            totalDurationMs: pt.totalDurationMs ?? pt.total_duration_ms ?? undefined,
            steps: Array.isArray(pt.steps)
              ? pt.steps.map((s: Record<string, unknown>) => ({
                  name: s.name,
                  durationMs: s.durationMs ?? s.duration_ms,
                  skipped: s.skipped ?? false,
                  skipReason: s.skipReason ?? s.skip_reason ?? undefined,
                }))
              : [],
          };
        }
      } else {
        const callFn = typeof this._executor.call === 'function'
          ? this._executor.call.bind(this._executor)
          : typeof this._executor.callAsync === 'function'
          ? this._executor.callAsync.bind(this._executor)
          : null;
        if (!callFn) {
          throw new Error('Executor must implement call() or callAsync()');
        }
        result = await callFn(toolName, args, context, versionHint);
      }

      const redacted = await this._maybeRedact(toolName, result);

      const content: TextContentDict[] = [
        {
          type: "text",
          text: this._formatResult(redacted),
          ...(traceMeta ? { _meta: { trace: traceMeta } } : {}),
        } as TextContentDict,
      ];

      const traceId = context?.traceId;
      return [content, false, traceId];
    } catch (error: unknown) {
      console.error(`handleCall error for ${toolName}:`, error);
      const errorInfo = this._errorMapper.toMcpError(error);

      const content: TextContentDict[] = [
        {
          type: "text",
          text: ExecutionRouter._buildErrorText(errorInfo),
        },
      ];

      return [content, true, undefined];
    }
  }

  /**
   * Preflight validation for a tool call without executing it.
   *
   * Delegates to `executor.validate()` if the executor supports it, and
   * returns a structured validation result.
   *
   * @param toolName - The MCP tool name (maps to apcore moduleId)
   * @param arguments_ - The tool call arguments to validate
   * @returns Structured validation result with checks array
   */
  async validateTool(
    toolName: string,
    arguments_: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      if (typeof this._executor.validate !== 'function') {
        return {
          valid: true,
          checks: [],
          requiresApproval: false,
        };
      }

      const rawResult = await this._executor.validate(toolName, arguments_);

      // Normalise result into {valid, checks, requiresApproval}
      if (rawResult && typeof rawResult === 'object' && 'valid' in (rawResult as object)) {
        const vr = rawResult as Record<string, unknown>;
        return {
          valid: vr.valid ?? true,
          checks: Array.isArray(vr.checks) ? vr.checks : [],
          requiresApproval: vr.requiresApproval ?? vr.requires_approval ?? false,
        };
      }

      // Array of errors → convert to checks format
      if (Array.isArray(rawResult)) {
        if (rawResult.length === 0) {
          return { valid: true, checks: [], requiresApproval: false };
        }
        const checks = rawResult.map((e: unknown) => {
          const msg = typeof e === 'string' ? e
            : (typeof e === 'object' && e !== null)
              ? (e as Record<string, unknown>).message ?? String(e)
              : String(e);
          return {
            check: typeof e === 'object' && e !== null ? ((e as Record<string, unknown>).field ?? 'validation') : 'validation',
            passed: false,
            error: { message: msg },
            warnings: [],
          };
        });
        return { valid: false, checks, requiresApproval: false };
      }

      // Unexpected shape — treat as valid
      return { valid: true, checks: [], requiresApproval: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        checks: [
          {
            check: "unexpected",
            passed: false,
            error: { message },
            warnings: [],
          },
        ],
        requiresApproval: false,
      };
    }
  }
}
