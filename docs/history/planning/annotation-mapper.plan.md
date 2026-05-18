# Implementation Plan: Annotation Mapper

## Feature
annotation-mapper

## Target
`src/adapters/annotations.ts`

## Status: COMPLETED

## Dependencies
- `src/types.ts` (ModuleAnnotations, McpAnnotationsDict interfaces)

## Implementation Tasks

### Task 1: Create AnnotationMapper class skeleton
- **Status:** Done
- **File:** `src/adapters/annotations.ts`
- **Details:** Export class with `toMcpAnnotations()`, `toDescriptionSuffix()`, `hasRequiresApproval()` public methods.

### Task 2: Implement `toMcpAnnotations()`
- **Status:** Done
- **Details:** Map apcore annotations to MCP hints: `readonly` -> `read_only_hint`, `destructive` -> `destructive_hint`, `idempotent` -> `idempotent_hint`, `open_world` -> `open_world_hint`. When annotations is null, return defaults `{false, false, false, true}`.

### Task 3: Implement `toDescriptionSuffix()`
- **Status:** Done
- **Details:** Return empty string for null annotations. Otherwise build `[annotations: readonly=true, destructive=false, idempotent=true, requires_approval=false, open_world=false]` format string with all 5 annotation fields.

### Task 4: Implement `hasRequiresApproval()`
- **Status:** Done
- **Details:** Return `false` for null annotations, otherwise return `annotations.requires_approval`.

## TDD Test Cases
- **File:** `tests/adapters/annotations.test.ts`
- **Status:** 12 tests passing
- TC-ANNOT-001: Destructive module maps correctly
- TC-ANNOT-002: Read-only module maps correctly
- TC-ANNOT-003: All-false module maps correctly
- TC-ANNOT-004: Null annotations produce defaults
- TC-ANNOT-005: Description suffix for non-null annotations
- TC-ANNOT-006: Description suffix for null annotations is empty
- TC-ANNOT-007: hasRequiresApproval returns true when set
- TC-ANNOT-008: hasRequiresApproval returns false when not set
- TC-ANNOT-009: hasRequiresApproval returns false for null annotations
- TC-ANNOT-010: open_world_hint mapping
- TC-ANNOT-SUFFIX-001: Suffix includes all 5 fields with correct values
- TC-ANNOT-SUFFIX-002: Suffix includes requires_approval field
