# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-02-25

### Added

- **Example modules**: `examples/` with 5 runnable demo modules — 3 class-based (`text_echo`, `math_calc`, `greeting`) and 2 programmatic via `module()` factory (`convert_temperature`, `word_count`) — for quick Explorer UI demo out of the box.

### Changed

- **BREAKING: `ExecutionRouter.handleCall()` return type**: Changed from `[content, isError]` to `[content, isError, traceId]`. Callers that unpack the 2-tuple must update to 3-tuple unpacking.
- **BREAKING: Explorer `/call` response format**: Changed from `{"result": ...}` / `{"error": ...}` to MCP-compliant `CallToolResult` format: `{"content": [...], "isError": bool, "_meta": {"_trace_id": ...}}`.

### Fixed

- **MCP protocol compliance**: Router no longer injects `_trace_id` as a content block in tool results. `traceId` is now returned as a separate tuple element and surfaced in Explorer responses via `_meta`. Factory handler throws errors for error results so the MCP SDK correctly sets `isError=true`.
- **Explorer UI default values**: `defaultFromSchema()` now correctly skips `null` defaults and falls through to type-based placeholders, fixing blank form fields for binding.yaml modules.

## [0.5.0] - 2026-02-25

### Added

- **MCP Tool Explorer** — Browser-based UI for inspecting and testing MCP tools, consistent with the Python (`apcore-mcp`) implementation. Mounts at `/explorer` on HTTP transports (`streamable-http`, `sse`); silently ignored for `stdio`.
  - `GET /explorer/` — Self-contained HTML single-page application (no external dependencies) displaying registered tools with annotation badges, input schemas, and a "Try it" section.
  - `GET /explorer/tools` — JSON array of tool summaries (name, description, annotations).
  - `GET /explorer/tools/{name}` — JSON tool detail including `inputSchema`.
  - `POST /explorer/tools/{name}/call` — Execute a tool from the browser UI. Returns 403 when execution is disabled.
- **`ExplorerHandler` class** — New `src/explorer/handler.ts` module handling all explorer HTTP routes. Accepts `ExplorerHandlerOptions` with `allowExecute` (default: `false`) and `prefix` (default: `"/explorer"`). Exported from public API.
- **`explorer`, `explorerPrefix`, `allowExecute` options in `ServeOptions`** — Enable the explorer UI, customize the URL prefix, and control tool execution from the browser.
- **`--explorer`, `--explorer-prefix`, `--allow-execute` CLI flags** — CLI support for all explorer options.
- **`setExplorerHandler()` on `TransportManager`** — Allows mounting the explorer into HTTP transport servers.
- New test suite `tests/explorer/explorer.test.ts` — 20 tests across 8 test groups (TC-001 through TC-008) covering HTML page, disabled-by-default, tool listing, tool detail, tool execution, execute-disabled 403, stdio-ignored, and custom prefix.

### Changed

- **`readBody()` exported from `TransportManager` module** — The shared `readBody()` utility in `src/server/transport.ts` is now exported for reuse by the explorer handler, eliminating code duplication.

## [0.4.0] - 2026-02-23

### Added

- **MCP Resources support** — New `registerResourceHandlers()` on `MCPServerFactory`. Modules with a `documentation` field are exposed as `docs://{moduleId}` MCP resources via `resources/list` and `resources/read`. Server now advertises `resources: {}` capability.
- **`/health` endpoint** — HTTP transports (`streamable-http`, `sse`) now serve a `/health` route returning JSON `{ status, uptime_seconds, module_count }` for readiness probing.
- **`/metrics` Prometheus endpoint** — HTTP transports (`streamable-http`, `sse`) now serve a `/metrics` route returning Prometheus text format when a `metricsCollector` is provided. Returns 404 when no collector is configured.
- **`MetricsExporter` interface** — Duck-typed interface for implementing custom Prometheus metrics exporters. Exported from public API.
- **`metricsCollector` option in `ServeOptions`** — Accepts a `MetricsExporter` instance to enable the `/metrics` endpoint on HTTP transports.
- **`Executor.validate?()` optional method** — New optional `validate(moduleId, inputs)` method on the `Executor` interface for pre-execution input validation.
- **`validateInputs` option in `ExecutionRouterOptions`** — When `true`, `ExecutionRouter` calls `executor.validate?.()` before execution and returns a formatted validation error response on failure. Exported from public API.
- **`tags` and `prefix` filtering in `ServeOptions`** — Pass `tags` and/or `prefix` to `serve()` to restrict which registry modules are exposed as MCP tools.
- **`logLevel` option in `ServeOptions`** — Suppresses `console` output below the specified level (`DEBUG` | `INFO` | `WARNING` | `ERROR`) during `serve()`. All suppressed methods are restored after shutdown.
- **`onStartup` / `onShutdown` lifecycle callbacks in `ServeOptions`** — Async hooks invoked before the transport starts and after it stops (including on error).
- **`--log-level` validation in CLI** — The `apcore-mcp` CLI now validates `--log-level` against the allowed set and passes it to `serve()`.
- **`streaming` field in `ModuleAnnotations`** — New boolean field to declare streaming capability in module metadata.
- New test suite `tests/serve-features.test.ts` — covers `tags`/`prefix` filtering (F1), `logLevel` suppression (F2), and `onStartup`/`onShutdown` lifecycle hooks (F4).
- New test suite `tests/server/metrics-endpoint.test.ts` — covers `/metrics` endpoint for both `streamable-http` and `sse` transports (200, 404, 500, content-type).
- New test suite `tests/server/router-validate.test.ts` — covers input validation in `ExecutionRouter` (F3).
- New test suite `tests/server/transport.test.ts` — covers `/health` endpoint for both transports, including `setModuleCount()` reflection.
- **`resolveRegistry()` and `resolveExecutor()` exported** — Both helper functions are now part of the public API, enabling advanced users to manually resolve Registry/Executor from a `RegistryOrExecutor` union without going through `serve()` or `toOpenaiTools()`.
- **`peerDependencies` declaration for `apcore-js`** — `package.json` now declares `apcore-js >= 0.4.0` as an optional peer dependency, informing users of the runtime requirement for CLI and bare-Registry modes.
- New test suite `tests/resolve-executor.test.ts` — covers `resolveRegistry()` (3 tests), `resolveExecutor()` pass-through and error paths (4 tests), and `serve()` integration (2 tests).
- New test suite `tests/cli.test.ts` — covers CLI argument validation, help output, apcore-js availability, success path with mocked apcore-js, module discovery logging, and log-level validation (13 tests).

### Changed

- **`toDescriptionSuffix` omits default annotation values** — `AnnotationMapper.toDescriptionSuffix()` now only includes fields that differ from their defaults (`readonly=false`, `destructive=false`, `idempotent=false`, `requiresApproval=false`, `openWorld=true`), producing shorter, more informative description suffixes.
- **Tool errors returned as MCP `isError` result** — `MCPServerFactory.registerHandlers()` no longer throws protocol-level errors for tool execution failures; errors are returned as `CallToolResult` with `isError: true` and the error message in `content`.
- **Progress notification index is now 1-based** — `notifications/progress` chunks sent from `ExecutionRouter` use a 1-based `progress` counter (was 0-based).
- **Trace ID appended to tool responses** — When a `BridgeContext` is active, a `{ _trace_id }` entry is appended to the response content array for both streaming and non-streaming paths.
- **`ModuleDescriptor.description` is now optional** — `MCPServerFactory.buildTool()` no longer throws when `description` is `null` or `undefined`.
- **`resolveExecutor()` tries auto-creating from `apcore`** — When a bare `Registry` is passed to `serve()`, it now attempts to dynamically `require('apcore')` and instantiate a default Executor before failing with a descriptive error.
- **`package.json` keywords expanded** — Added `mcp-server`, `tool-bridge`, `agent-tools`, `schema`, `json-schema`, `validation`, `router`, `transport`, `cli` for better npm discoverability.

### Fixed

- **Package name corrected from `"apcore"` to `"apcore-js"`** — `resolveExecutor()` in `src/index.ts` used `require("apcore")` and CLI in `src/cli.ts` used `import("apcore")`, which would fail even when `apcore-js` was installed. Both now reference the correct package name `"apcore-js"`, with updated error messages.

- **Null-safe `call` / `callAsync` selection** — `ExecutionRouter` now uses `typeof` checks instead of truthiness when selecting between `executor.call()` and `executor.callAsync()`, preventing accidental fallthrough on falsy executor methods.
- **`serve()` input validation** — `serve()` now validates `name` (non-empty, ≤ 255 chars), `tags` (no empty strings), and `prefix` (non-empty if provided) before starting, throwing descriptive errors.

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
