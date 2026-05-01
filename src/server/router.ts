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

import * as crypto from "node:crypto";
import { ErrorMapper } from "../adapters/errors.js";
import type { Executor, TextContentDict, McpErrorResponse } from "../types.js";
import { createBridgeContext } from "./context.js";
import { MCP_PROGRESS_KEY, MCP_ELICIT_KEY } from "../helpers.js";
import type { ElicitResult } from "../helpers.js";
import { getCurrentIdentity } from "../auth/storage.js";
import { parseTraceparent } from "./trace-context.js";
import type { AsyncTaskBridge } from "./async-task-bridge.js";

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
 * - `_meta.traceparent` — W3C trace_context header propagated from caller
 */
export interface HandleCallExtra {
  sendNotification?: (notification: Record<string, unknown>) => Promise<void>;
  sendRequest?: (request: Record<string, unknown>, resultSchema: unknown) => Promise<unknown>;
  _meta?: {
    progressToken?: string | number;
    apcore?: { version?: string };
    traceparent?: string;
  };
  versionHint?: string;
  /**
   * Transport session id (e.g. SSEServerTransport.sessionId or
   * StreamableHTTPServerTransport's per-session UUID). When present and
   * the bridge is wired, it's recorded so transport-disconnect can call
   * `cancelSessionTasks(sessionKey)` for cooperative cancellation.
   * [A-D-018]
   */
  sessionId?: string;
  /**
   * Per-call id for cooperative cancellation. When omitted, the router
   * derives one from `_meta.progressToken` or generates a UUID. Wired
   * by transport-level handlers parsing inbound MCP
   * `notifications/cancelled` and forwarding to `router.cancel(callId)`.
   * [B-002]
   */
  callId?: string | number;
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
  /**
   * Optional AsyncTaskBridge that intercepts calls to async-hinted modules
   * and the four reserved `__apcore_task_*` meta-tools. When absent, all
   * calls go through the synchronous executor path.
   */
  asyncTaskBridge?: AsyncTaskBridge;
}

/**
 * Cooperative cancellation token. Mirrors apcore-py's CancelToken and
 * Rust's apcore::CancelToken. [B-002]
 */
export class CancelToken {
  private _cancelled = false;
  get isCancelled(): boolean {
    return this._cancelled;
  }
  cancel(): void {
    this._cancelled = true;
  }
}

/**
 * [B-002] Maximum number of cancel-token entries (active + tombstones)
 * kept in the per-router map. When exceeded, oldest entries are evicted
 * in insertion order. Without this cap, tombstones from cancels on
 * unknown call_ids would accumulate unboundedly.
 */
const CANCEL_TOKENS_MAX = 4096;

export class ExecutionRouter {
  private readonly _executor: Executor;
  private readonly _errorMapper: ErrorMapper;
  private readonly _validateInputs: boolean;
  private readonly _outputFormatter?: (result: Record<string, unknown>) => string;
  private readonly _redactOutput: boolean;
  private readonly _outputSchemaMap: Record<string, Record<string, unknown>>;
  private readonly _trace: boolean;
  private readonly _asyncTaskBridge?: AsyncTaskBridge;
  /**
   * [B-002] Per-server `call_id → CancelToken` map. Populated on
   * tool-call entry by handleCall(); consulted by cancel(callId).
   * Transport layer should forward inbound MCP `notifications/cancelled`
   * to `router.cancel(callId, reason)`.
   */
  private readonly _cancelTokens = new Map<string, CancelToken>();

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
    this._asyncTaskBridge = options?.asyncTaskBridge;
  }

  /** Expose the async task bridge (for factory tool-list merging). */
  get asyncTaskBridge(): AsyncTaskBridge | undefined {
    return this._asyncTaskBridge;
  }

  /**
   * Cooperatively cancel an in-flight tool call. [B-002]
   *
   * Looks up the CancelToken registered for `callId` in handleCall and
   * calls `token.cancel()`. Subsequent checks (e.g., from inside the
   * executing module via `context.cancelToken?.isCancelled`) will see
   * the cancellation. When `callId` is unknown (cancel arrived before
   * submit, or after the call completed), records a tombstone so a
   * subsequent same-id submit immediately sees the cancellation.
   *
   * Returns true when a token was found and cancelled; false when the
   * callId was unknown (tombstone recorded). Wired by transport-level
   * handlers parsing inbound MCP `notifications/cancelled` messages.
   */
  cancel(callId: string, reason?: string): boolean {
    const existing = this._cancelTokens.get(callId);
    if (existing) {
      // Re-insert to refresh insertion order (Map preserves it).
      this._cancelTokens.delete(callId);
      this._cancelTokens.set(callId, existing);
      existing.cancel();
      this._evictCancelTokens();
      return true;
    }
    const tombstone = new CancelToken();
    tombstone.cancel();
    this._cancelTokens.set(callId, tombstone);
    this._evictCancelTokens();
    void reason; // referenced for API symmetry; reserved for future logging
    return false;
  }

  /**
   * Internal: register a CancelToken for the duration of a tool call.
   * Returns the token (already cancelled if a tombstone was recorded
   * before the call landed).
   */
  _registerCancelToken(callId: string): CancelToken {
    const existing = this._cancelTokens.get(callId);
    const token = new CancelToken();
    if (existing && existing.isCancelled) {
      // Tombstone race: cancel arrived before submit.
      token.cancel();
    }
    // Re-insert to refresh ordering (Map preserves insertion order).
    this._cancelTokens.delete(callId);
    this._cancelTokens.set(callId, token);
    this._evictCancelTokens();
    return token;
  }

  /** Internal: release a token slot after the call completes. */
  _releaseCancelToken(callId: string): void {
    this._cancelTokens.delete(callId);
  }

  /**
   * [B-002] Cap the cancel-tokens map at CANCEL_TOKENS_MAX. Map preserves
   * insertion order, so iterator gives oldest first.
   */
  private _evictCancelTokens(): void {
    while (this._cancelTokens.size > CANCEL_TOKENS_MAX) {
      const oldest = this._cancelTokens.keys().next().value;
      if (oldest === undefined) break;
      this._cancelTokens.delete(oldest);
    }
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
    // [B-002] Register a CancelToken for this call so that an inbound
    // MCP `notifications/cancelled` (forwarded by the transport into
    // `router.cancel(callId, reason)`) cooperatively cancels in-flight
    // work. The callId is sourced from `extra.callId`,
    // `_meta.progressToken`, or generated. Released in `finally`.
    const rawCallId =
      (extra as { callId?: string | number } | undefined)?.callId ??
      extra?._meta?.progressToken;
    const callId =
      typeof rawCallId === "string" || typeof rawCallId === "number"
        ? String(rawCallId)
        : crypto.randomUUID();
    const cancelToken = this._registerCancelToken(callId);
    try {
      return await this._handleCallInner(toolName, args, extra, cancelToken);
    } finally {
      this._releaseCancelToken(callId);
    }
  }

  private async _handleCallInner(
    toolName: string,
    args: Record<string, unknown>,
    extra: HandleCallExtra | undefined,
    cancelToken: CancelToken,
  ): Promise<CallResult> {
    try {
      // ── Build context with MCP callbacks ──────────────────────────────
      const progressToken = extra?._meta?.progressToken;
      const sendNotification = extra?.sendNotification;
      const sendRequest = extra?.sendRequest;
      const traceparentRaw = extra?._meta?.traceparent;

      // Parse incoming W3C traceparent so the downstream trace chain continues.
      let inboundTraceId: string | undefined;
      if (typeof traceparentRaw === "string" && traceparentRaw.length > 0) {
        const parsed = await parseTraceparent(traceparentRaw);
        if (parsed) {
          inboundTraceId = parsed.traceId;
        }
      }

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

      // [A-D-001] Always create a context so the cancelToken is threaded
      // into the executor pipeline. Without this, modules cannot observe
      // inbound MCP `notifications/cancelled` via `context.cancelToken?.isCancelled`
      // and cooperative cancellation is silently broken — the router-level
      // cancel API works but the cancel signal never reaches the running module.
      // Mirrors Python's `context.cancel_token = cancel_token` (router.py:379).
      const context = createBridgeContext(
        contextData,
        identity,
        inboundTraceId,
        cancelToken,
      );

      // Preserve the pre-fix traceId return contract: return the context's
      // trace_id only when the call carried "meaningful" trace context
      // (callbacks, identity, or inbound traceparent). Otherwise the returned
      // traceId is undefined so vanilla calls don't leak a freshly-generated
      // UUID. The internal context still has a UUID for child() chains.
      const effectiveTraceId: string | undefined =
        hasCallbacks || identity || inboundTraceId ? context.traceId : undefined;

      // ── F-043: Async Task Bridge meta-tool dispatch ────────────────────
      if (this._asyncTaskBridge && this._asyncTaskBridge.isMetaTool(toolName)) {
        try {
          const metaResult = await this._asyncTaskBridge.handleMetaTool(
            toolName,
            args,
            context,
          );
          const content: TextContentDict[] = [
            { type: "text", text: this._formatResult(metaResult) },
          ];
          return [content, false, effectiveTraceId];
        } catch (err: unknown) {
          const errorInfo = this._errorMapper.toMcpError(err);
          const content: TextContentDict[] = [
            { type: "text", text: ExecutionRouter._buildErrorText(errorInfo) },
          ];
          return [content, true, effectiveTraceId];
        }
      }

      // ── F-043: Async-hinted module → AsyncTaskManager.submit() ─────────
      if (this._asyncTaskBridge && this._asyncTaskBridge.enabled) {
        let descriptor: import("../types.js").ModuleDescriptor | null = null;
        try {
          descriptor = this._executor.registry?.getDefinition?.(toolName) ?? null;
        } catch {
          // registry lookup is best-effort — leave descriptor null
        }
        if (this._asyncTaskBridge.isAsyncModule(descriptor)) {
          try {
            // [A-D-018] Forward progressToken AND sessionKey so the bridge
            // records both for terminal-state fan-out (progressToken) and
            // transport-disconnect cancellation (sessionKey via
            // cancelSessionTasks).
            const submitProgressToken = extra?._meta?.progressToken;
            const envelope = await this._asyncTaskBridge.submit(
              toolName,
              args,
              context,
              {
                progressToken:
                  typeof submitProgressToken === "string" ||
                  typeof submitProgressToken === "number"
                    ? submitProgressToken
                    : undefined,
                sessionKey: extra?.sessionId,
              },
            );
            const content: TextContentDict[] = [
              { type: "text", text: this._formatResult(envelope) },
            ];
            return [content, false, effectiveTraceId];
          } catch (err: unknown) {
            const errorInfo = this._errorMapper.toMcpError(err);
            const content: TextContentDict[] = [
              { type: "text", text: ExecutionRouter._buildErrorText(errorInfo) },
            ];
            return [content, true, effectiveTraceId];
          }
        }
      }

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

          // Per-chunk redaction MUST happen before the chunk is serialized
          // into the progress notification — otherwise an x-sensitive
          // credential emitted mid-stream leaks to the MCP client even
          // though the final accumulated result is later redacted.
          // Mirrors Python's _handle_stream invariant. [A-D-003]
          const safeChunk = await this._maybeRedact(toolName, chunk as Record<string, unknown>);

          // Send progress notification for each chunk (redacted)
          await sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: chunkIndex + 1,
              message: JSON.stringify(safeChunk),
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

        const traceId = effectiveTraceId;
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

      const traceId = effectiveTraceId;
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
