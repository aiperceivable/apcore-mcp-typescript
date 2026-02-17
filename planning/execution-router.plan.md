# Implementation Plan: Execution Router

## Feature
execution-router

## Target
`src/server/router.ts`

## Status: COMPLETED

## Dependencies
- `src/adapters/errors.ts` (ErrorMapper)
- `src/types.ts` (Executor, TextContentDict interfaces)

## Implementation Tasks

### Task 1: Create ExecutionRouter class skeleton
- **Status:** Done
- **File:** `src/server/router.ts`
- **Details:** Export class with constructor accepting `Executor` and `handleCall()` method. Compose ErrorMapper internally.

### Task 2: Implement success path in `handleCall()`
- **Status:** Done
- **Details:** Call `executor.call_async(toolName, args)`, wrap result in `[{type: "text", text: JSON.stringify(result)}]`, return `[content, false]`.

### Task 3: Implement error handling in `handleCall()`
- **Status:** Done
- **Details:** Catch errors, map through `ErrorMapper.toMcpError()`, return `[{type: "text", text: errorMessage}], true]`. Handle both ModuleError and generic Error types.

### Task 4: Implement logging
- **Status:** Done
- **Details:** Log tool calls at debug level with module name and arguments. Log errors at debug level with error details.

## TDD Test Cases
- **File:** `tests/server/router.test.ts`
- **Status:** 7 tests passing
- TC-EXEC-001: Successful execution returns JSON result with isError=false
- TC-EXEC-002: Calls executor.call_async with correct arguments
- TC-EXEC-003: ModuleError mapped through ErrorMapper
- TC-EXEC-004: Generic Error returns error response
- TC-EXEC-005: Non-Error thrown value handled
- TC-EXEC-006: Result serialized as JSON string
- TC-EXEC-007: Error response has isError=true
