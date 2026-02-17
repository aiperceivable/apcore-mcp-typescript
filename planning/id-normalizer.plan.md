# Implementation Plan: Module ID Normalizer

## Feature
id-normalizer

## Target
`src/adapters/idNormalizer.ts`

## Status: COMPLETED

## Dependencies
- None (standalone utility)

## Implementation Tasks

### Task 1: Create ModuleIDNormalizer class
- **Status:** Done
- **File:** `src/adapters/idNormalizer.ts`
- **Details:** Export class with `normalize()` and `denormalize()` methods.

### Task 2: Implement `normalize()`
- **Status:** Done
- **Details:** Replace all `.` with `-` using `replaceAll(".", "-")`. Converts apcore dot-notation module IDs to OpenAI-compatible function names.

### Task 3: Implement `denormalize()`
- **Status:** Done
- **Details:** Replace all `-` with `.` using `replaceAll("-", ".")`. Converts OpenAI function names back to apcore module IDs. Bijective inverse of `normalize()`.

## TDD Test Cases
- **File:** `tests/adapters/idNormalizer.test.ts`
- **Status:** 7 tests passing
- TC-NORMALIZE-001: "image.resize" -> "image-resize"
- TC-NORMALIZE-002: "text.analyze.sentiment" -> "text-analyze-sentiment"
- TC-NORMALIZE-003: "simple" (no dots) -> "simple"
- TC-DENORMALIZE-001: "image-resize" -> "image.resize"
- TC-DENORMALIZE-002: "text-analyze-sentiment" -> "text.analyze.sentiment"
- TC-DENORMALIZE-003: "simple" (no dashes) -> "simple"
- TC-ROUNDTRIP: normalize(denormalize(x)) == x
