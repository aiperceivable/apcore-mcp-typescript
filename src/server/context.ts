/**
 * BridgeContext — minimal duck-typed context for apcore executors.
 *
 * Since apcore-mcp-typescript does NOT depend on apcore-js, we create a
 * structural stand-in that satisfies the executor's context contract:
 *
 *   if (context == null) { return Context.create(this).child(moduleId); }
 *   return context.child(moduleId);
 *
 * The key requirement: child() returns a new context that shares the same
 * `data` reference so MCP callbacks remain accessible throughout the call chain.
 */

import { randomUUID } from "node:crypto";

/** Shape of the bridge context object. */
export interface BridgeContext {
  readonly traceId: string;
  readonly callerId: string | null;
  readonly callChain: readonly string[];
  readonly executor: unknown;
  readonly identity: Record<string, unknown> | null;
  redactedInputs: Record<string, unknown> | null;
  readonly data: Record<string, unknown>;
  child(moduleId: string): BridgeContext;
}

/**
 * Create a minimal bridge context that carries `data` through executor call chains.
 *
 * @param data - Shared data dict (MCP callbacks are injected here)
 * @returns A BridgeContext with a working child() method
 */
export function createBridgeContext(data: Record<string, unknown>): BridgeContext {
  return _buildContext(data, randomUUID(), null, []);
}

function _buildContext(
  data: Record<string, unknown>,
  traceId: string,
  callerId: string | null,
  callChain: string[],
): BridgeContext {
  return {
    traceId,
    callerId,
    callChain,
    executor: null,
    identity: null,
    redactedInputs: null,
    data,
    child(moduleId: string): BridgeContext {
      // Match real Context.child(): callerId = last element of current callChain
      const newCallerId = callChain.length > 0 ? callChain[callChain.length - 1] : null;
      return _buildContext(data, traceId, newCallerId, [...callChain, moduleId]);
    },
  };
}
