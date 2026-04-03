# Feature: apcore Config Bus and ErrorFormatterRegistry Integration

**Commit:** 5fdaef43ed100aaa7508ec3e61dba425e4eda8db

### Problem
Previously, MCP server configuration (transport, host, port, auth, etc.) was handled separately from the main `apcore` configuration system. This forced users to manage multiple configuration sources (CLI flags, environment variables, or separate YAML files) for different parts of their application. Additionally, error formatting was not unified, meaning MCP-specific errors didn't follow the shared `apcore` ecosystem protocols.

### Why it needs to be fixed
Integrating with the `apcore` Config Bus and ErrorFormatterRegistry provides a unified configuration experience and consistent error handling across all `apcore` services (Python, Rust, and TypeScript). It allows users to configure the entire ecosystem via a single `apcore.yaml` file or standardized `APCORE_*` environment variables, reducing complexity and potential for misconfiguration.

### How it was resolved
1.  **Config Bus Registration**: Registered the `mcp` namespace with the `apcore` Config Bus using the `APCORE_MCP` environment prefix.
2.  **Error Formatter Registry**: Implemented `McpErrorFormatter` and registered it with `apcore`'s `ErrorFormatterRegistry` under the `mcp` name.
3.  **Dependency Update**: Bumped `apcore-js` dependency to `>=0.15.1` to support the new Config Bus and Error Formatter protocols.
4.  **Event Constants**: Added dot-namespaced event constants (`APCORE_EVENTS`) to align with `apcore` 0.15.0 specifications.
5.  **Error Mappings**: Added 6 new error code mappings related to configuration and formatting conflicts.

### How it was verified
1.  **Unit Tests**: Added `tests/config.test.ts` to verify namespace registration, environment prefixing, and default values.
2.  **Formatter Tests**: Added `tests/adapters/mcpErrorFormatter.test.ts` to ensure the formatter correctly handles `ModuleError` and plain `Error` objects according to the `ErrorFormatter` interface.
3.  **Idempotency**: Verified that registration functions are idempotent and do not throw when called multiple times.
