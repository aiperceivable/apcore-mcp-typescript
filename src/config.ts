/**
 * MCP config namespace registration for the Config Bus (apcore 0.15.0 §9.4).
 *
 * Registers the "mcp" namespace so users can configure apcore-mcp via
 * YAML (under the `mcp:` key) or env vars prefixed with APCORE_MCP_.
 */
import { Config } from "apcore-js";

export const MCP_NAMESPACE = "mcp";
export const MCP_ENV_PREFIX = "APCORE_MCP";

export const MCP_DEFAULTS: Record<string, unknown> = {
  transport: "stdio",
  host: "127.0.0.1",
  port: 8000,
  name: "apcore-mcp",
  log_level: null,
  validate_inputs: false,
  explorer: false,
  explorer_prefix: "/explorer",
  require_auth: true,
};

/** Register the 'mcp' config namespace. Safe to call multiple times. */
export function registerMcpNamespace(): void {
  try {
    const reg = (Config as unknown as Record<string, unknown>)["registerNamespace"] as
      | ((opts: Record<string, unknown>) => void)
      | undefined;
    if (reg) {
      reg({
        name: MCP_NAMESPACE,
        envPrefix: MCP_ENV_PREFIX,
        defaults: MCP_DEFAULTS,
      });
    }
  } catch {
    // Already registered or registerNamespace not available in this apcore-js version
  }
}
