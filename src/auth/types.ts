/**
 * Authentication interfaces for apcore-mcp.
 *
 * Re-exports the Identity type from apcore-js and defines the
 * Authenticator interface that transport-level auth implementations must satisfy.
 */

import type { Identity } from "apcore-js";

// Re-export Identity from apcore-js so consumers don't need a direct dependency
export type { Identity };

/**
 * Authenticator interface — implemented by auth strategies (e.g. JWT).
 *
 * `authenticate()` inspects a flat headers map and returns an Identity
 * for authenticated requests, or `null` for unauthenticated/invalid requests.
 *
 * The transport layer extracts headers from IncomingMessage before calling
 * this method, keeping auth logic decoupled from the HTTP stack (matching
 * Python `authenticate(headers: dict)` and Rust `authenticate(&HashMap)`).
 */
export interface Authenticator {
  authenticate(headers: Record<string, string>): Promise<Identity | null>;
  /** Whether unauthenticated requests should be rejected. Default true. */
  readonly requireAuth?: boolean;
}
