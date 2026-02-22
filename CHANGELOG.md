# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-02-22

### Added

- **Streaming execution support** — The MCP bridge layer now supports streaming execution. When an executor implements `stream()` and the client provides a `progressToken`, chunks are forwarded as `notifications/progress` and shallow-merged into the final result. Falls back to `call()` when streaming is not available or not requested.
- **Elicitation and progress reporting** — New `helpers.ts` module with `reportProgress()` and `elicit()` functions for modules to report progress and request user input during execution.
- **BridgeContext** — New duck-typed context object that carries shared data through call chains, with support for MCP callbacks and progress reporting.
- `stream?()` method added to `Executor` interface for streaming support.
- `HandleCallExtra` interface for MCP SDK callbacks (`sendNotification`, `sendRequest`, `_meta`).
- `context?: unknown` parameter added to Executor interface methods (`call`, `stream`, `getDefinition`) for backward-compatible context passing.
- `_meta.streaming` property added to OpenAI tool definitions when module descriptor has `annotations.streaming`.
- Exported `helpers`, `BridgeContext` type, and `createBridgeContext` from public API.
- 7 streaming router tests covering chunks, fallback, and edge cases.

### Changed

- `ExecutionRouter` now builds context with MCP callbacks and passes it to executors.
- `factory.ts` wired to pass MCP SDK extra parameters to router for streaming and elicitation support.

### Fixed

- **BridgeContext.child() callerId alignment** — `callerId` now equals the last element of parent's `callChain` (who called me), matching apcore-typescript Context.child() behavior.
- `redactedInputs` is now nullable (null initial) to match real Context behavior.
- Added `readonly` modifiers to BridgeContext properties to match real Context's immutability contract.

## [0.2.0] - 2026-02-20

### Changed

- **Breaking: All TypeScript interfaces now use camelCase** — Updated all type definitions in `types.ts` to follow TypeScript conventions (e.g., `module_id` → `moduleId`, `input_schema` → `inputSchema`, `get_definition` → `getDefinition`, `call_async` → `callAsync`). MCP hint properties also updated (e.g., `read_only_hint` → `readOnlyHint`).
- All adapters, converters, and server components refactored to use the new camelCase property names.
- All test files updated to match the new interface signatures (113 tests passing across 10 test files).

### Added

- New constants in `types.ts`: `REGISTRY_EVENTS`, `ErrorCodes`, and `MODULE_ID_PATTERN` for standardized error codes and validation.
- New type alias `RegistryOrExecutor` for accepting either Registry or Executor.
- `has?()` method on Registry interface for optional module existence checking.
- Improved JSDoc comments in `types.ts` with section dividers and clearer documentation.

## [0.1.1] - 2026-02-18

### Fixed

- **Circular `$ref` detection in SchemaConverter** — Self-referencing or mutually recursive `$ref` (e.g., TreeNode with children: TreeNode[]) now throws a descriptive `Circular $ref detected` error instead of causing infinite recursion / stack overflow.
- **Request body size limit in HTTP transports** — `readBody()` now enforces a maximum body size (default 4MB) to prevent memory exhaustion DoS. Oversized requests receive HTTP 413; malformed JSON receives HTTP 400.

### Added

- Environment variable `APCORE_MAX_BODY_BYTES` to configure the maximum request body size for HTTP transports (StreamableHTTP and SSE). Defaults to 4,194,304 (4MB).

## [0.1.0] - 2026-02-17

### Added

- Initial project setup with MCP server, schema conversion, transport management, and OpenAI tools bridge.
