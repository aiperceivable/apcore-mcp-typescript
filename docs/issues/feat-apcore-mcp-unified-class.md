# Feature: Unified APCoreMCP Class and Advanced Annotation Support

**Commit:** d0155ffec4c1d046ad241838611bd949f8d325e1

### Problem
As the `apcore-mcp` library grew, users had to interact with multiple top-level functions (`serve`, `asyncServe`, `toOpenaiTools`) and manage registry/executor instances manually. This complexity made it harder to get started. Additionally, the library lacked support for new metadata annotations introduced in `apcore-js` v0.13.0, specifically for caching and pagination.

### Why it needs to be fixed
A unified entry point simplifies the developer experience by providing a single object to manage the entire MCP server lifecycle and OpenAI tool export. Supporting `cacheable` and `paginated` annotations ensures that the MCP server can leverage the full performance and scalability features of the underlying `apcore` modules.

### How it was resolved
1.  **APCoreMCP Class**: Introduced the `APCoreMCP` class in `src/apcore-mcp.ts` as a unified entry point. It handles lazy resolution of registries from directory paths and provides high-level methods for serving and tool export.
2.  **Annotation Support**: Updated `ModuleAnnotations` and `AnnotationMapper` to support `cacheable`, `cacheTtl`, `cacheKeyFields`, `paginated`, and `paginationStyle`.
3.  **Output Formatting**: Added an `outputFormatter` option to allow users to customize how tool results are serialized for LLM consumption.
4.  **Dependency Update**: Bumped `apcore-js` to `>=0.13.0` to pick up the new annotation types.

### How it was verified
1.  **Comprehensive Unit Tests**: Created `tests/apcore-mcp.test.ts` covering constructor validation, backend resolution, and method delegation.
2.  **Formatter Tests**: Added tests in `tests/server/router.test.ts` to verify that the `outputFormatter` is correctly applied to dictionary results and handles errors gracefully.
3.  **Mock Verification**: Used Vitest mocks to ensure the `APCoreMCP` class correctly delegates to the underlying server factory and transport manager.
