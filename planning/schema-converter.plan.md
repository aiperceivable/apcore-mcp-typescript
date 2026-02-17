# Implementation Plan: Schema Converter

## Feature
schema-converter

## Target
`src/adapters/schema.ts`

## Status: COMPLETED

## Dependencies
- `src/types.ts` (JsonSchema, ModuleDescriptor interfaces)

## Implementation Tasks

### Task 1: Create SchemaConverter class skeleton
- **Status:** Done
- **File:** `src/adapters/schema.ts`
- **Details:** Export class with `convertInputSchema()` and `convertOutputSchema()` public methods, plus internal `_convertSchema()`, `_inlineRefs()`, `_resolveRef()`, `_ensureObjectType()`.

### Task 2: Implement `_ensureObjectType()`
- **Status:** Done
- **Details:** If schema has `properties` but no `type`, add `type: "object"`. If schema is empty `{}`, return `{ type: "object", properties: {} }`.

### Task 3: Implement `_resolveRef()`
- **Status:** Done
- **Details:** Parse `$ref` string, validate it starts with `#/$defs/`, extract definition name, look up in `$defs` dict. Throw `Error("Invalid $ref format")` or `Error("$ref not found")` on failure.

### Task 4: Implement `_inlineRefs()` with circular detection
- **Status:** Done
- **Details:** Recursively traverse schema. For objects with `$ref` key, resolve and inline. Track visited refs via `Set<string>` to detect circular references. Handle `$ref` in `items`, `oneOf`, `anyOf`, `allOf`, nested `properties`.

### Task 5: Implement `_convertSchema()` orchestration
- **Status:** Done
- **Details:** Deep-copy via `structuredClone()`, extract `$defs`, call `_inlineRefs()`, delete `$defs` from result, call `_ensureObjectType()`.

### Task 6: Wire public methods
- **Status:** Done
- **Details:** `convertInputSchema(descriptor)` delegates to `_convertSchema(descriptor.input_schema)`. `convertOutputSchema(descriptor)` delegates to `_convertSchema(descriptor.output_schema)`.

## TDD Test Cases
- **File:** `tests/adapters/schema.test.ts`
- **Status:** 15 tests passing
- TC-SCHEMA-001: Simple schema without $ref preserves properties/types/required/enums
- TC-SCHEMA-002: Single-level $ref inlining, strips $defs
- TC-SCHEMA-003: Nested $ref chains (A references B)
- TC-SCHEMA-004: Circular $ref detection throws
- TC-SCHEMA-005: Empty input_schema -> `{type: "object", properties: {}}`
- TC-SCHEMA-006: Strip $defs when no $ref references exist
- TC-SCHEMA-007: $ref inside array items
- TC-SCHEMA-008: $ref inside oneOf
- TC-SCHEMA-009: Adds type "object" when missing but has properties
- TC-SCHEMA-010: Does not mutate original schema
- TC-SCHEMA-011: output_schema conversion works same as input_schema
- TC-SCHEMA-012: Preserves all JSON Schema types
- TC-SCHEMA-ERR-001: Invalid $ref format throws
- TC-SCHEMA-ERR-002: $ref to non-existent definition throws
- TC-SCHEMA-ERR-003: $ref with empty name throws
