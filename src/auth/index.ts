/**
 * Auth module barrel exports.
 *
 * NOTE [A-D-230 / D9-003]: `createAuthMiddleware` (and `./middleware.ts`)
 * have been removed. The factory was orphan code with no production caller
 * inside the bridge, and asyncServe never wired it into the HTTP transport.
 * A future PR landing the asyncServe wiring should reintroduce a fresh
 * middleware module that integrates with the live transport stack rather
 * than resurrect a stale stub.
 */

export type { Authenticator, Identity } from "./types.js";
export { JWTAuthenticator } from "./jwt.js";
export type { ClaimMapping, JWTAuthenticatorOptions } from "./jwt.js";
export { identityStorage, getCurrentIdentity } from "./storage.js";
