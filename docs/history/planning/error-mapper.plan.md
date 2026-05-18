# Implementation Plan: Error Mapper

## Feature
error-mapper

## Target
`src/adapters/errors.ts`

## Status: COMPLETED

## Dependencies
- `src/types.ts` (ModuleError, McpErrorResponse interfaces)

## Implementation Tasks

### Task 1: Create ErrorMapper class skeleton
- **Status:** Done
- **File:** `src/adapters/errors.ts`
- **Details:** Export class with `toMcpError()` public method and internal helpers `_isModuleError()`, `_formatValidationError()`. Define `INTERNAL_ERROR_CODES` constant set.

### Task 2: Implement duck-type `_isModuleError()` check
- **Status:** Done
- **Details:** Check for `code` (string) and `message` (string) properties to identify apcore ModuleError instances without importing the class. Avoids compile-time dependency on apcore.

### Task 3: Define INTERNAL_ERROR_CODES set
- **Status:** Done
- **Details:** Set containing `"CALL_DEPTH_EXCEEDED"`, `"CIRCULAR_CALL"`, `"CALL_FREQUENCY_EXCEEDED"` - codes whose details should be sanitized.

### Task 4: Implement `_formatValidationError()`
- **Status:** Done
- **Details:** Extract field-level validation errors from `details.errors` array. Format as `"field: message"` lines. Fall back to error message if no structured details available.

### Task 5: Implement `toMcpError()` routing logic
- **Status:** Done
- **Details:** Route based on error type and code: internal codes -> generic message, `ACL_DENIED` -> sanitized "Access denied", `SCHEMA_VALIDATION_ERROR` -> formatted fields, other ModuleError -> direct message, unknown Error -> "Internal error occurred". All responses have `is_error: true`.

## TDD Test Cases
- **File:** `tests/adapters/errors.test.ts`
- **Status:** 11 tests passing
- TC-ERROR-001: ModuleError with standard code returns structured response
- TC-ERROR-002: CALL_DEPTH_EXCEEDED sanitized to generic message
- TC-ERROR-003: CIRCULAR_CALL sanitized
- TC-ERROR-004: CALL_FREQUENCY_EXCEEDED sanitized
- TC-ERROR-005: ACL_DENIED returns "Access denied"
- TC-ERROR-006: SCHEMA_VALIDATION_ERROR with field details
- TC-ERROR-007: SCHEMA_VALIDATION_ERROR without structured details
- TC-ERROR-008: Unknown Error returns generic "Internal error occurred"
- TC-ERROR-009: Non-Error thrown value returns generic response
- TC-ERROR-010: All responses have is_error: true
- TC-ERROR-011: ModuleError with details included in response
