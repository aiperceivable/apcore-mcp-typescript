/**
 * MCP extension helpers for apcore modules.
 *
 * Provides reportProgress() and elicit() that modules can call during execute().
 * Both read callbacks injected into context.data by the ExecutionRouter.
 * Gracefully no-op when callbacks are absent (non-MCP execution paths).
 */

/** Structural type for any object carrying a `data` dict (duck-typed Context). */
interface HasData {
  data: Record<string, unknown>;
}

/** Key under context.data where the progress callback is stored. */
export const MCP_PROGRESS_KEY = "_mcp_progress";

/** Key under context.data where the elicitation callback is stored. */
export const MCP_ELICIT_KEY = "_mcp_elicit";

/** Result returned from an elicitation request. */
export interface ElicitResult {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

/**
 * Report execution progress to the MCP client.
 *
 * No-ops silently when called outside an MCP context (no callback injected).
 *
 * @param context - Object with a `data` dict (apcore Context or BridgeContext)
 * @param progress - Current progress value
 * @param total - Optional total for percentage calculation
 * @param message - Optional human-readable progress message
 */
export async function reportProgress(
  context: HasData,
  progress: number,
  total?: number,
  message?: string,
): Promise<void> {
  const callback = context.data[MCP_PROGRESS_KEY] as
    | ((progress: number, total?: number, message?: string) => Promise<void>)
    | undefined;
  if (callback) {
    await callback(progress, total, message);
  }
}

/**
 * Ask the MCP client for user input via the elicitation protocol.
 *
 * Returns null when called outside an MCP context (no callback injected).
 *
 * @param context - Object with a `data` dict (apcore Context or BridgeContext)
 * @param message - Message to display to the user
 * @param requestedSchema - Optional JSON Schema describing the expected input
 * @returns ElicitResult with the user's action and optional content, or null
 */
export async function elicit(
  context: HasData,
  message: string,
  requestedSchema?: Record<string, unknown>,
): Promise<ElicitResult | null> {
  const callback = context.data[MCP_ELICIT_KEY] as
    | ((message: string, requestedSchema?: Record<string, unknown>) => Promise<ElicitResult | null>)
    | undefined;
  if (callback) {
    return callback(message, requestedSchema);
  }
  return null;
}
