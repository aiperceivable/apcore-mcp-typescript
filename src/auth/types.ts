/**
 * Authentication interfaces for apcore-mcp.
 *
 * Re-exports the Identity type from apcore-js and defines the
 * Authenticator interface that transport-level auth implementations must satisfy.
 */

import type { IncomingMessage } from "node:http";
import type { Identity } from "apcore-js";

// Re-export Identity from apcore-js so consumers don't need a direct dependency
export type { Identity };

/**
 * Authenticator interface — implemented by auth strategies (e.g. JWT).
 *
 * `authenticate()` inspects incoming HTTP headers and returns an Identity
 * for authenticated requests, or `null` for unauthenticated/invalid requests.
 */
export interface Authenticator {
  authenticate(req: IncomingMessage): Promise<Identity | null>;
  /** Whether unauthenticated requests should be rejected. Default true. */
  readonly requireAuth?: boolean;
}
