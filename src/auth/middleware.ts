/**
 * AuthMiddleware — HTTP-level authentication middleware for apcore-mcp transports.
 *
 * Mirrors Python's `apcore_mcp/auth/middleware.py` AuthMiddleware and Rust's
 * `apcore_mcp::auth::middleware::AuthMiddleware`. Sits in front of any
 * Node `http`/`https` request handler to:
 *
 *   1. Skip auth for exempt paths (default: `/health`, `/metrics`, `/usage`)
 *      and exempt prefixes — these mirror the transport's existing
 *      health/metrics/usage endpoints.
 *   2. Flatten request headers to a `Record<string, string>` and delegate to
 *      the configured {@link Authenticator}.
 *   3. On auth failure (no/invalid Bearer), reject with a structured
 *      `401 Unauthorized` JSON body and the `WWW-Authenticate: Bearer`
 *      header. Permissive mode (`requireAuth: false`) instead forwards
 *      the request without an identity.
 *   4. On success, run the downstream handler inside `identityStorage.run()`
 *      so `getCurrentIdentity()` resolves to the authenticated identity for
 *      the entire async call chain (executor.call, ErrorMapper guidance,
 *      observability spans, etc.).
 *
 * NOTE: This module exposes the middleware factory only. Wiring into
 * `serve()`/`asyncServe()` is a separate, explicit follow-up so existing
 * deployments aren't surprised by a new auth gate. [A-D-230]
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Authenticator } from "./types.js";
import { identityStorage } from "./storage.js";

/**
 * Downstream handler invoked when auth succeeds (or is exempt/permissive).
 *
 * @internal
 *
 * Re-exported only from `src/auth/middleware.ts`. The public package barrel
 * intentionally omits this type until A-D-230 wires the middleware into the
 * asyncServe HTTP transport. Consumers should not depend on it.
 */
export type NextHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

/**
 * Options for {@link createAuthMiddleware}.
 *
 * @internal
 *
 * See {@link NextHandler} for the @internal rationale.
 */
export interface AuthMiddlewareOptions {
  /** Authenticator that validates the Bearer token. Required. */
  authenticator: Authenticator;
  /**
   * Paths that bypass auth entirely. Default mirrors transport.ts:111 —
   * `{"/health", "/metrics", "/usage"}` so health probes and Prometheus
   * scrapes work out of the box without credentials.
   */
  exemptPaths?: Set<string>;
  /**
   * Path prefixes that bypass auth. Default empty. Useful for namespacing
   * an explorer UI under (e.g.) `/explorer` without per-route exemption.
   */
  exemptPrefixes?: Set<string>;
  /**
   * Whether to reject unauthenticated requests with 401. Default `true`.
   * When `false` (permissive mode), unauthenticated requests are forwarded
   * to the downstream handler without an identity in scope — useful for
   * explorer/dev-mode deployments that mix authenticated and anonymous
   * usage. Mirrors the equivalent option on Python's AuthMiddleware.
   */
  requireAuth?: boolean;
}

/**
 * Default exempt paths — kept in sync with TransportManager.exemptPaths.
 *
 * @internal
 *
 * See {@link NextHandler} for the @internal rationale.
 */
export const DEFAULT_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  "/health",
  "/metrics",
  "/usage",
]);

/**
 * Auth middleware function compatible with Node's `http` request handlers.
 *
 * @internal
 *
 * See {@link NextHandler} for the @internal rationale.
 */
export type AuthMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: NextHandler,
) => Promise<void>;

/**
 * Build an HTTP auth middleware around an {@link Authenticator}.
 *
 * Cross-language contract:
 * - 401 body matches Python/Rust verbatim:
 *   `{"error": "Unauthorized", "detail": "Missing or invalid Bearer token"}`
 * - Sets `WWW-Authenticate: Bearer` per RFC 6750.
 * - Wraps `next()` in `identityStorage.run(identity, ...)` so downstream
 *   code calling `getCurrentIdentity()` sees the authenticated principal.
 *
 * @internal
 *
 * Implementation lives here and is reachable via the package's source tree
 * for testing, but the top-level package barrel does NOT re-export this
 * factory. The middleware is not yet wired into `asyncServe()`'s HTTP
 * transport (tracked under A-D-230). Re-exposed once wiring lands.
 */
export function createAuthMiddleware(
  options: AuthMiddlewareOptions,
): AuthMiddleware {
  const exemptPaths = options.exemptPaths ?? new Set(DEFAULT_EXEMPT_PATHS);
  const exemptPrefixes = options.exemptPrefixes ?? new Set<string>();
  const requireAuth = options.requireAuth ?? true;
  const authenticator = options.authenticator;

  return async (req, res, next) => {
    const url = req.url ?? "/";
    // Strip query string before path-matching — `/health?probe=1` must hit
    // the exempt list. URL parsing isn't necessary for a path-only check
    // and avoids depending on a base URL when none is naturally available.
    const queryIdx = url.indexOf("?");
    const pathname = queryIdx === -1 ? url : url.slice(0, queryIdx);

    // Flatten Node's `IncomingHttpHeaders` (string | string[] | undefined)
    // to a lowercase Record<string, string> matching the Authenticator
    // contract. Multi-value headers are joined per HTTP/1.1 convention.
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers[key.toLowerCase()] = Array.isArray(value)
        ? value.join(", ")
        : String(value);
    }

    // [D11-1] Cross-language parity: on exempt paths/prefixes, Python and
    // Rust still call the authenticator in best-effort mode so
    // getCurrentIdentity() resolves to a populated principal when a valid
    // token is present (used by ErrorMapper guidance, observability spans,
    // and downstream logic that should be identity-aware even on /health).
    // Errors are swallowed because the path is exempt by design.
    const isExempt =
      exemptPaths.has(pathname) ||
      [...exemptPrefixes].some(
        (prefix) => prefix.length > 0 && pathname.startsWith(prefix),
      );
    if (isExempt) {
      let identity: Awaited<ReturnType<Authenticator["authenticate"]>> | null =
        null;
      try {
        identity = await authenticator.authenticate(headers);
      } catch {
        // Best-effort: exempt paths must remain reachable regardless of
        // authenticator failures. Identity stays null.
      }
      if (identity) {
        return identityStorage.run(identity, () => next(req, res));
      }
      return next(req, res);
    }

    const identity = await authenticator.authenticate(headers);
    if (!identity) {
      if (requireAuth) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("WWW-Authenticate", "Bearer");
        res.end(
          JSON.stringify({
            error: "Unauthorized",
            detail: "Missing or invalid Bearer token",
          }),
        );
        return;
      }
      // Permissive mode: forward without identity in scope.
      return next(req, res);
    }

    // Wrap downstream in identityStorage so getCurrentIdentity() works
    // across the entire async chain. Mirrors Python's contextvar
    // `identity_var.set(identity)` and Rust's `task_local!` scope.
    return identityStorage.run(identity, () => next(req, res));
  };
}
