# Implementation Plan: Public API

## Feature
public-api

## Target
`src/index.ts`

## Status: COMPLETED

## Dependencies
- `src/server/factory.ts` (MCPServerFactory)
- `src/server/router.ts` (ExecutionRouter)
- `src/server/transport.ts` (TransportManager)
- `src/converters/openai.ts` (OpenAIConverter)
- `src/types.ts` (Registry, Executor, RegistryOrExecutor interfaces)

## Implementation Tasks

### Task 1: Implement `resolveRegistry()`
- **Status:** Done
- **File:** `src/index.ts`
- **Details:** Internal helper. If input has `registry` property (Executor), return `input.registry`. If input has `list` and `get_definition` (Registry), return as-is. Throw otherwise.

### Task 2: Implement `resolveExecutor()`
- **Status:** Done
- **Details:** Internal helper. If input has `call_async` (Executor), return as-is. If it's a plain Registry, throw `Error("Cannot create Executor from Registry")` since apcore can't be imported at compile time.

### Task 3: Implement `serve()` function
- **Status:** Done
- **Details:** Async function. Resolve registry and executor. Create server via factory, build tools, register handlers with router, start transport. Supports `transport`, `host`, `port`, `name`, `version` options. Default transport is `"stdio"`.

### Task 4: Implement `toOpenaiTools()` function
- **Status:** Done
- **Details:** Sync function. Resolve registry. Delegate to `OpenAIConverter.convertRegistry()`. Supports `embedAnnotations`, `strict`, `tags`, `prefix` options.

### Task 5: Export public types
- **Status:** Done
- **Details:** Re-export key types for consumers: `ModuleDescriptor`, `ModuleAnnotations`, `Registry`, `Executor`, `OpenAIToolDef`, etc.

## TDD Test Cases
- **File:** `tests/api.test.ts`
- **Status:** 8 tests passing
- TC-API-001: toOpenaiTools with mock registry returns tools
- TC-API-002: toOpenaiTools with empty registry returns empty array
- TC-API-003: toOpenaiTools passes options through
- TC-API-004: resolveRegistry from Executor extracts .registry
- TC-API-005: resolveRegistry from Registry returns as-is
- TC-API-006: resolveExecutor from Executor returns as-is
- TC-API-007: resolveExecutor from Registry throws
- TC-API-008: serve() throws for unknown transport type
