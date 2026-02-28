/**
 * Identity propagation via AsyncLocalStorage.
 *
 * Replaces Python's ContextVar pattern for propagating the authenticated
 * identity through the async call chain without explicit parameter passing.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Identity } from "apcore-js";

/** AsyncLocalStorage instance that carries the current Identity through async scopes. */
export const identityStorage = new AsyncLocalStorage<Identity | null>();

/**
 * Get the current Identity from the async context.
 *
 * Returns `null` if called outside an `identityStorage.run()` scope
 * or if the scope was entered with a `null` identity.
 */
export function getCurrentIdentity(): Identity | null {
  return identityStorage.getStore() ?? null;
}
