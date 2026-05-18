# Implementation Plan: OpenAI Converter

## Feature
openai-converter

## Target
`src/converters/openai.ts`

## Status: COMPLETED

## Dependencies
- `src/adapters/schema.ts` (SchemaConverter)
- `src/adapters/annotations.ts` (AnnotationMapper)
- `src/adapters/idNormalizer.ts` (ModuleIDNormalizer)
- `src/types.ts` (Registry, ModuleDescriptor, OpenAIToolDef interfaces)

## Implementation Tasks

### Task 1: Create OpenAIConverter class skeleton
- **Status:** Done
- **File:** `src/converters/openai.ts`
- **Details:** Export class with `convertRegistry()` and `convertDescriptor()` public methods. Compose SchemaConverter, AnnotationMapper, ModuleIDNormalizer internally. Export `ConvertOptions` and `ConvertRegistryOptions` interfaces.

### Task 2: Implement `convertDescriptor()`
- **Status:** Done
- **Details:** Normalize module ID, convert schema, optionally append annotation suffix to description, build `{ type: "function", function: { name, description, parameters, strict? } }` structure.

### Task 3: Implement strict mode via `_applyStrictMode()`
- **Status:** Done
- **Details:** Set `additionalProperties: false` on all objects, make all properties required (missing -> add to required array), wrap optional properties in `{ anyOf: [original, { type: "null" }] }`. Recursive via `_applyStrictRecursive()`.

### Task 4: Implement `convertRegistry()`
- **Status:** Done
- **Details:** Call `registry.list({ tags, prefix })`, iterate IDs, get definitions, convert each via `convertDescriptor()`. Skip null definitions. Return array of OpenAIToolDef.

## TDD Test Cases
- **File:** `tests/converters/openai.test.ts`
- **Status:** 12 tests passing
- TC-OPENAI-001: Basic descriptor conversion returns correct structure
- TC-OPENAI-002: Module ID normalized (dots to dashes)
- TC-OPENAI-003: normalize("image.resize") == "image-resize"
- TC-OPENAI-004: denormalize("image-resize") == "image.resize"
- TC-OPENAI-005: Annotation embedding appends suffix to description
- TC-OPENAI-006: No annotation embedding by default
- TC-OPENAI-007: Strict mode adds additionalProperties and required
- TC-OPENAI-008: Strict mode makes optional properties nullable
- TC-OPENAI-009: Registry conversion returns correct count
- TC-OPENAI-010: Empty registry returns empty array
- TC-OPENAI-011: Registry with tags filter
- TC-OPENAI-012: Strict mode function-level flag set to true
