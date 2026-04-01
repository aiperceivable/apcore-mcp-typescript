/**
 * MCP error formatter registered with apcore's ErrorFormatterRegistry (§8.8).
 */
import type { ErrorFormatter } from "apcore-js";
import { ErrorMapper } from "./errors.js";

/**
 * MCP-specific error formatter that wraps ErrorMapper for the
 * apcore ErrorFormatterRegistry protocol.
 */
export class McpErrorFormatter implements ErrorFormatter {
  private readonly errorMapper = new ErrorMapper();

  format(error: unknown, _context?: unknown): Record<string, unknown> {
    return this.errorMapper.toMcpError(error) as unknown as Record<string, unknown>;
  }
}

/** Register the MCP error formatter. Safe to call multiple times. */
export async function registerMcpFormatter(): Promise<void> {
  try {
    const { ErrorFormatterRegistry } = await import("apcore-js");
    if (!ErrorFormatterRegistry.get("mcp")) {
      ErrorFormatterRegistry.register("mcp", new McpErrorFormatter());
    }
  } catch {
    // ErrorFormatterRegistry not available in this apcore-js version
  }
}
