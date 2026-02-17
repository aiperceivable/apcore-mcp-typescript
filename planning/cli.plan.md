# Implementation Plan: CLI Entry Point

## Feature
cli

## Target
`src/cli.ts`

## Status: COMPLETED (excluded from coverage)

## Dependencies
- `node:util` (parseArgs)
- `node:path`, `node:fs` (path resolution, directory validation)
- `apcore` (dynamic import at runtime)
- `src/index.ts` (serve function)

## Implementation Tasks

### Task 1: Create CLI argument parser
- **Status:** Done
- **File:** `src/cli.ts`
- **Details:** Use `parseArgs` from `node:util` to parse `--extensions-dir`, `--transport`, `--host`, `--port`, `--name`, `--version`, `--log-level` arguments with proper types and defaults.

### Task 2: Implement argument validation
- **Status:** Done
- **Details:** Validate extensions directory exists and is a directory. Validate port range (1-65535). Validate name length (<= 255 chars). Validate transport is one of `stdio`, `streamable-http`, `sse`.

### Task 3: Implement dynamic apcore import
- **Status:** Done
- **Details:** Dynamic `import("apcore")` with `@ts-expect-error` to avoid compile-time dependency. Creates `Registry` and discovers modules from extensions directory.

### Task 4: Implement server launch
- **Status:** Done
- **Details:** Call `serve()` with resolved registry and CLI options. Handle errors with proper exit codes: 1 for invalid arguments, 2 for startup failure.

### Task 5: Wire bin entry point
- **Status:** Done
- **Details:** `package.json` registers `apcore-mcp` binary pointing to `dist/cli.js`.

## TDD Test Cases
- **Status:** No unit tests (CLI requires integration testing with real apcore module)
- **Notes:** `src/cli.ts` is excluded from coverage thresholds. CLI testing would require mocking `node:fs`, `node:path`, and dynamic `import("apcore")` which adds complexity without proportional value. The `serve()` function it delegates to is fully tested.

## Notes
- Uses `@ts-expect-error` for the dynamic `import("apcore")` since apcore is a peer dependency not available at compile time
- Exit codes follow Unix convention: 0 success, 1 user error, 2 system error
