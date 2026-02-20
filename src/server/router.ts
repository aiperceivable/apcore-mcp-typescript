/**
 * ExecutionRouter - Routes MCP tool calls to apcore module execution.
 *
 * Bridges the MCP tools/call protocol with apcore's Executor.call() or callAsync(),
 * handling success/error formatting for MCP text content responses.
 */

import { ErrorMapper } from "../adapters/errors.js";
import type { Executor, TextContentDict } from "../types.js";

/** Tuple of [content array, isError flag] returned from handleCall. */
export type CallResult = [TextContentDict[], boolean];

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
   * Tries executor.call() first, then falls back to executor.callAsync().
   *
   * @param toolName - The MCP tool name (maps to apcore moduleId)
   * @param args - The tool call arguments
   * @returns Tuple of [content, isError] where content is an array of text content dicts
   */
  async handleCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallResult> {
    try {
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
