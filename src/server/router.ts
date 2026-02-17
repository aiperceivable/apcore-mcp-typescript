/**
 * ExecutionRouter - Routes MCP tool calls to apcore module execution.
 *
 * Bridges the MCP tools/call protocol with apcore's Executor.call_async(),
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
   * @param executor - Duck-typed executor with call_async(module_id, inputs)
   */
  constructor(executor: Executor) {
    this._executor = executor;
    this._errorMapper = new ErrorMapper();
  }

  /**
   * Handle an MCP tools/call request by routing to the executor.
   *
   * @param toolName - The MCP tool name (maps to apcore module_id)
   * @param args - The tool call arguments
   * @returns Tuple of [content, isError] where content is an array of text content dicts
   */
  async handleCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallResult> {
    try {
      const result = await this._executor.call_async(toolName, args);

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
