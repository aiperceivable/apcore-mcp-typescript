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
  traceId: string;
  callerId: string | null;
  callChain: string[];
  executor: unknown;
  identity: Record<string, unknown> | null;
  redactedInputs: Record<string, unknown>;
  data: Record<string, unknown>;
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
    redactedInputs: {},
    data,
    child(moduleId: string): BridgeContext {
      return _buildContext(data, traceId, moduleId, [...callChain, moduleId]);
    },
  };
}
