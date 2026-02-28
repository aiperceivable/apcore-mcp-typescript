/**
 * Auth module barrel exports.
 */

export type { Authenticator, Identity } from "./types.js";
export { JWTAuthenticator } from "./jwt.js";
export type { ClaimMapping, JWTAuthenticatorOptions } from "./jwt.js";
export { identityStorage, getCurrentIdentity } from "./storage.js";
