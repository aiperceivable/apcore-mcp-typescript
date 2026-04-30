/**
 * W3C Trace Context ↔ MCP `_meta.traceparent` bridging.
 *
 * Inbound (parse): when an MCP `tools/call` request carries
 * `_meta.traceparent`, we dynamically import apcore-js's `TraceContext`
 * utility to validate and extract the 32-hex trace_id, which is then used
 * as the BridgeContext's traceId so downstream middleware (including apcore
 * tracing middleware) continues the same trace.
 *
 * Outbound (inject): after a successful tool execution the bridge attaches
 * `_meta.traceparent` to the response carrying the current trace_id plus a
 * freshly generated parent-id. Mirrors apcore's `TraceContext.inject()` shape
 * (`00-<traceId>-<parentId>-01`) without requiring apcore-js to be installed.
 *
 * We rely on apcore-js's built-in traceparent validation when available —
 * this module never duplicates the regex; falls back to a minimal
 * structural check if apcore-js is absent.
 */

import { randomBytes } from "node:crypto";

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Parsed W3C traceparent header. */
export interface ParsedTraceParent {
  readonly version: string;
  readonly traceId: string;
  readonly parentId: string;
  readonly traceFlags: string;
}

/**
 * Parse a W3C traceparent header value. Returns `null` for malformed or
 * W3C-reserved (version=ff, all-zero trace_id/parent_id) headers.
 *
 * Prefers apcore-js `TraceContext.fromTraceparent()` when available so the
 * cross-language contract stays identical. Falls back to an inline regex
 * that matches the apcore spec.
 */
export async function parseTraceparent(raw: string): Promise<ParsedTraceParent | null> {
  if (typeof raw !== "string" || raw.length === 0) return null;

  // Prefer apcore-js's validator to stay in sync with the core SDK.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apcore = (await import("apcore-js")) as any;
    const TraceContext = apcore.TraceContext ?? apcore.default?.TraceContext;
    if (TraceContext && typeof TraceContext.fromTraceparent === "function") {
      try {
        return TraceContext.fromTraceparent(raw) as ParsedTraceParent;
      } catch {
        return null;
      }
    }
  } catch {
    // apcore-js unavailable — fall through to local parse
  }

  const match = TRACEPARENT_RE.exec(raw.trim().toLowerCase());
  if (match === null) return null;
  const [, version, traceId, parentId, traceFlags] = match;
  if (version === "ff") return null;
  if (traceId === "0".repeat(32) || parentId === "0".repeat(16)) return null;
  return { version, traceId, parentId, traceFlags };
}

/**
 * Build a W3C traceparent string from a trace_id. Generates a fresh parent_id
 * and sets the sampled flag.
 */
export function buildTraceparent(traceId: string): string {
  const parentId = randomBytes(8).toString("hex");
  return `00-${traceId}-${parentId}-01`;
}
