/**
 * apcore-mcp bridge — centralized constants module.
 *
 * Mirrors:
 *   - Python: `src/apcore_mcp/constants.py`
 *   - Rust:   `src/constants.rs`
 *
 * [D8-005] Structural-parity addition: the TypeScript SDK historically
 * distributed its constants across `src/types.ts` (ErrorCodes,
 * REGISTRY_EVENTS, APCORE_EVENTS, MODULE_ID_PATTERN), `src/config.ts`
 * (MCP_NAMESPACE, MCP_ENV_PREFIX, MCP_DEFAULTS), and `src/helpers.ts`
 * (MCP_PROGRESS_KEY, MCP_ELICIT_KEY). Each of those modules remains the
 * canonical source so the existing imports stay green, but this file
 * re-exports them through a single barrel for cross-language structural
 * parity with the python/rust SDKs and for new code that wants one
 * import line. Add new shared constants here directly.
 */

export {
  REGISTRY_EVENTS,
  ErrorCodes,
  APCORE_EVENTS,
  MODULE_ID_PATTERN,
} from "./types.js";

export {
  MCP_NAMESPACE,
  MCP_ENV_PREFIX,
  MCP_DEFAULTS,
} from "./config.js";

export {
  MCP_PROGRESS_KEY,
  MCP_ELICIT_KEY,
} from "./helpers.js";

// ─── Transport / server defaults ─────────────────────────────────────────────
//
// These mirror the values hardcoded in `serve()` and `MCP_DEFAULTS` so
// consumers (and downstream apcore-toolkit integrations) can reference one
// canonical name instead of duplicating literals. The values must stay in
// lock-step with `src/config.ts:MCP_DEFAULTS` and the `?? ...` fallbacks in
// `src/index.ts::serve`.

/** Default TCP host for HTTP-based MCP transports. */
export const DEFAULT_HOST = "127.0.0.1";

/** Default TCP port for HTTP-based MCP transports. */
export const DEFAULT_PORT = 8000;

/** Default MCP server name. */
export const DEFAULT_SERVER_NAME = "apcore-mcp";

/** Default explorer URL prefix. */
export const DEFAULT_EXPLORER_PREFIX = "/explorer";

// ─── Transport names ─────────────────────────────────────────────────────────

/** Canonical MCP transport identifiers accepted by `serve()`. */
export const TRANSPORTS = Object.freeze({
  STDIO: "stdio",
  STREAMABLE_HTTP: "streamable-http",
  SSE: "sse",
} as const);

/** Union type of valid transport names. */
export type TransportName = (typeof TRANSPORTS)[keyof typeof TRANSPORTS];
