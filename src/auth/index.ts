/**
 * Auth module barrel exports.
 *
 * NOTE [A-D-230 / D9-005]: `createAuthMiddleware` is intentionally NOT
 * re-exported here. The factory in `./middleware.ts` exists for the
 * eventual asyncServe wiring but has no caller inside the bridge today;
 * advertising it publicly would imply a contract the package doesn't
 * deliver. Import directly from `./middleware.ts` for internal use; the
 * barrel re-export returns once A-D-230 wires the middleware into the
 * asyncServe HTTP transport.
 */

export type { Authenticator, Identity } from "./types.js";
export { JWTAuthenticator } from "./jwt.js";
export type { ClaimMapping, JWTAuthenticatorOptions } from "./jwt.js";
export { identityStorage, getCurrentIdentity } from "./storage.js";
