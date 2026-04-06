/**
 * MCP error formatter that wraps ErrorMapper.
 *
 * When apcore-js exposes ErrorFormatterRegistry (planned §8.8),
 * this class can be registered there. Until then it is used directly.
 */
import { ErrorMapper } from "./errors.js";

export interface ErrorFormatter {
  format(error: unknown, context?: unknown): Record<string, unknown>;
}

/**
 * MCP-specific error formatter that wraps ErrorMapper.
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
    const apcore = await import("apcore-js");
    const registry = (apcore as Record<string, unknown>)["ErrorFormatterRegistry"] as
      | { get(k: string): unknown; register(k: string, v: unknown): void }
      | undefined;
    if (registry && !registry.get("mcp")) {
      registry.register("mcp", new McpErrorFormatter());
    }
  } catch {
    // ErrorFormatterRegistry not available in this apcore-js version
  }
}
