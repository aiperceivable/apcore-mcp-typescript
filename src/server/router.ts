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
import type { Executor, TextContentDict } from "../types.js";

/** Tuple of [content array, isError flag] returned from handleCall. */
export type CallResult = [TextContentDict[], boolean];

/**
 * Extra context passed from the MCP SDK request handler.
 *
 * Mirrors the relevant subset of the SDK's `RequestHandlerExtra`:
 * - `sendNotification` — sends an out-of-band notification on the current session
 * - `_meta.progressToken` — opaque token the client attached to the request
 */
export interface HandleCallExtra {
  sendNotification?: (notification: Record<string, unknown>) => Promise<void>;
  _meta?: { progressToken?: string | number };
}

export class ExecutionRouter {
  private readonly _executor: Executor;
  private readonly _errorMapper: ErrorMapper;

  /**
   * Create an ExecutionRouter.
   *
   * @param executor - Duck-typed executor with call(moduleId, inputs) or callAsync(moduleId, inputs)
   */
  constructor(executor: Executor) {
    this._executor = executor;
    this._errorMapper = new ErrorMapper();
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
   * @returns Tuple of [content, isError] where content is an array of text content dicts
   */
  async handleCall(
    toolName: string,
    args: Record<string, unknown>,
    extra?: HandleCallExtra,
  ): Promise<CallResult> {
    try {
      // ── Streaming path ────────────────────────────────────────────────
      const progressToken = extra?._meta?.progressToken;
      const sendNotification = extra?.sendNotification;

      if (
        this._executor.stream &&
        progressToken !== undefined &&
        sendNotification
      ) {
        let accumulated: Record<string, unknown> = {};
        let chunkIndex = 0;

        for await (const chunk of this._executor.stream(toolName, args)) {
          // Shallow-merge each chunk into the accumulated result
          accumulated = { ...accumulated, ...chunk };

          // Send progress notification for each chunk
          await sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: chunkIndex,
              message: JSON.stringify(chunk),
            },
          });

          chunkIndex++;
        }

        const content: TextContentDict[] = [
          {
            type: "text",
            text: JSON.stringify(accumulated),
          },
        ];

        return [content, false];
      }

      // ── Non-streaming path ────────────────────────────────────────────
      const callFn = this._executor.call
        ? this._executor.call.bind(this._executor)
        : this._executor.callAsync?.bind(this._executor);
      if (!callFn) {
        throw new Error("Executor must implement call() or callAsync()");
      }
      const result = await callFn(toolName, args);

      const content: TextContentDict[] = [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ];

      return [content, false];
    } catch (error: unknown) {
      const errorInfo = this._errorMapper.toMcpError(error);

      const content: TextContentDict[] = [
        {
          type: "text",
          text: errorInfo.message,
        },
      ];

      return [content, true];
    }
  }
}
