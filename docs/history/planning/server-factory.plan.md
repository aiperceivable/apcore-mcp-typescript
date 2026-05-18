# Implementation Plan: MCP Server Factory

## Feature
server-factory

## Target
`src/server/factory.ts`

## Status: COMPLETED

## Dependencies
- `@modelcontextprotocol/sdk` (Server, ListToolsRequestSchema, CallToolRequestSchema, Tool, TextContent types)
- `src/adapters/schema.ts` (SchemaConverter)
- `src/adapters/annotations.ts` (AnnotationMapper)
- `src/types.ts` (Registry, ModuleDescriptor interfaces)
- `src/server/router.ts` (ExecutionRouter)

## Implementation Tasks

### Task 1: Create MCPServerFactory class skeleton
- **Status:** Done
- **File:** `src/server/factory.ts`
- **Details:** Export class with `createServer()`, `buildTool()`, `buildTools()`, `registerHandlers()` methods. Compose SchemaConverter and AnnotationMapper internally.

### Task 2: Implement `createServer()`
- **Status:** Done
- **Details:** Create low-level `Server` from `@modelcontextprotocol/sdk/server/index.js` with name, version, and `{ capabilities: { tools: {} } }`.

### Task 3: Implement `buildTool()`
- **Status:** Done
- **Details:** Map descriptor to MCP Tool: `name = module_id`, `description`, `inputSchema` via SchemaConverter, `annotations` mapped to camelCase hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).

### Task 4: Implement `buildTools()`
- **Status:** Done
- **Details:** Iterate `registry.list()`, call `get_definition()` for each, build tool. Skip null definitions with `console.warn`. Catch and log errors for individual modules.

### Task 5: Implement `registerHandlers()`
- **Status:** Done
- **Details:** Register `ListToolsRequestSchema` handler returning `{ tools }`. Register `CallToolRequestSchema` handler that extracts `name`/`arguments`, calls `router.handleCall()`, returns `CallToolResult`. On `isError=true`, throws `new Error(content[0].text)`. Handles null arguments with `args ?? {}`.

## TDD Test Cases
- **File:** `tests/server/factory.test.ts`
- **Status:** 11 tests passing
- TC-FACTORY-001: createServer returns Server with connect method
- TC-FACTORY-002: buildTool creates correct Tool structure
- TC-FACTORY-003: buildTool maps annotations to MCP hint format
- TC-FACTORY-004: buildTool with null annotations uses defaults
- TC-FACTORY-005: buildTools iterates registry correctly
- TC-FACTORY-006: buildTools skips null definitions with warning
- TC-FACTORY-007: buildTools skips modules that throw errors
- TC-FACTORY-008: buildTools with empty registry returns empty array
- TC-FACTORY-HANDLERS-001: registerHandlers returns tools on list, routes calls
- TC-FACTORY-HANDLERS-002: registerHandlers throws on router isError=true
- TC-FACTORY-HANDLERS-003: registerHandlers handles null arguments
