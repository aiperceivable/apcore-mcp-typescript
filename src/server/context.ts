/**
 * Bridge context factory.
 *
 * apcore-mcp-typescript depends on apcore-js (a hard `dependencies` entry), so
 * the bridge uses apcore-js's real `Context` instead of a hand-rolled structural
 * stand-in. `createBridgeContext` is a thin factory that seeds an apcore
 * `Context` with the MCP call's `data` (which carries MCP callbacks), identity,
 * inbound W3C trace_id, and cancel token. `BridgeContext` is retained as a public
 * type alias for `Context` so existing importers keep compiling.
 *
 * Why this is no longer a custom type: the previous `BridgeContext` was a manual
 * mirror of apcore-js's `Context` and had to chase every upstream change
 * (Issue #66 executor auto-bind, D-18 `signal`, trace-flag propagation) — and it
 * had already drifted, producing dashed-UUID trace_ids instead of the 32-hex W3C
 * format apcore enforces. Delegating to the real `Context` removes that drift and
 * matches apcore-mcp-python, which already builds contexts via `Context.create()`.
 */

import { Context } from "apcore-js";
import type { CancelToken, TraceParent } from "apcore-js";
import type { Identity } from "../auth/types.js";

/**
 * Public type alias for the apcore execution context produced by this bridge.
 * Retained for backward compatibility with importers of `BridgeContext`.
 */
export type BridgeContext = Context;

/**
 * Create an apcore `Context` that carries `data` through executor call chains.
 *
 * The returned context holds the same `data` reference, and `Context.child()`
 * preserves it, so MCP callbacks injected into `data` remain accessible
 * throughout the call chain.
 *
 * @param data - Shared data dict (MCP callbacks are injected here).
 * @param identity - Authenticated identity, if any.
 * @param traceId - Optional inbound W3C trace_id (32 lowercase hex). When
 *   provided it seeds the context's `traceId` so the downstream trace chain
 *   stays linked; when omitted (or not valid 32-hex) apcore generates a fresh
 *   W3C trace_id.
 * @param cancelToken - Cooperative + real-interrupt cancel token (D-18). Threaded
 *   in so modules can read `context.cancelToken?.isCancelled` (cooperative) or
 *   `context.signal` (real abort).
 * @returns An apcore `Context` with a working `child()` method.
 */
export function createBridgeContext(
  data: Record<string, unknown>,
  identity?: Identity | null,
  traceId?: string,
  cancelToken?: CancelToken | null,
): Context {
  // A TraceParent is the only Context.create channel for an externally-supplied
  // trace_id. traceFlags is left empty so apcore does not inject a
  // `_apcore.trace.flags` key into `data` — preserving the prior bridge
  // behaviour of propagating only the trace_id (not the inbound sampling flags).
  const traceParent: TraceParent | null = traceId
    ? {
        version: "00",
        traceId,
        parentId: "0".repeat(16),
        traceFlags: "",
        tracestate: [],
      }
    : null;
  return Context.create(identity ?? null, traceParent, cancelToken ?? null, data);
}
