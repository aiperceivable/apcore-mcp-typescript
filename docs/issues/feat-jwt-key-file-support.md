# Feature: JWT Key File Support and Auth Alignment

**Commit:** 3380c104c5ae91a19aea789fb631327d26edf773

### Problem
The MCP server only supported JWT secrets provided directly via CLI flags or environment variables. It lacked the ability to read verification keys (such as RS256/ES256 public keys) from PEM files, which is a common requirement for production security. Furthermore, the authentication behavior and key resolution priority were not fully aligned with the Python and Rust implementations of the apcore SDK.

### Why it needs to be fixed
Aligning the authentication mechanism across all SDK languages (Python, Rust, and TypeScript) ensures a consistent security model for developers. Supporting key files allows for better security practices, such as rotating keys without changing environment variables or CLI configurations, and supports more complex algorithms like RS256/ES256.

### How it was resolved
1.  **New CLI Flag**: Added the `--jwt-key-file` flag to the CLI to allow specifying a path to a PEM-encoded key file.
2.  **Key Resolution Priority**: Implemented a standardized resolution order: `--jwt-key-file` > `--jwt-secret` > `APCORE_JWT_SECRET` environment variable.
3.  **File Reading Logic**: Integrated synchronous file reading in the CLI entry point to resolve the key before initializing the `JWTAuthenticator`.
4.  **Documentation**: Updated the `README.md` with the new flag and the updated resolution priority tables.

### How it was verified
1.  **CLI Integration Tests**: Added tests in `tests/cli.test.ts` to verify that the server correctly reads secrets from a file.
2.  **Priority Verification**: Added a test case ensuring that `--jwt-key-file` takes precedence over `--jwt-secret` when both are provided.
3.  **Error Handling**: Verified that the CLI fails gracefully with a descriptive error message if the specified key file cannot be read.
