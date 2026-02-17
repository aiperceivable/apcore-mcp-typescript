# apcore-mcp Implementation Plan Overview

## Project

**Name:** apcore-mcp
**Language:** TypeScript
**Description:** Automatic MCP Server & OpenAI Tools Bridge for apcore — converts apcore module registries into MCP tool definitions and OpenAI-compatible function calling formats.

## Feature Execution Order

The following plans should be implemented in the order listed. Dependencies flow top-down — each feature may depend on features above it.

| Order | Plan | Target | Status |
|-------|------|--------|--------|
| 1 | [schema-converter](schema-converter.plan.md) | `src/adapters/schema.ts` | COMPLETED |
| 2 | [annotation-mapper](annotation-mapper.plan.md) | `src/adapters/annotations.ts` | COMPLETED |
| 3 | [error-mapper](error-mapper.plan.md) | `src/adapters/errors.ts` | COMPLETED |
| 4 | [id-normalizer](id-normalizer.plan.md) | `src/adapters/idNormalizer.ts` | COMPLETED |
| 5 | [openai-converter](openai-converter.plan.md) | `src/converters/openai.ts` | COMPLETED |
| 6 | [server-factory](server-factory.plan.md) | `src/server/factory.ts` | COMPLETED |
| 7 | [execution-router](execution-router.plan.md) | `src/server/router.ts` | COMPLETED |
| 8 | [transport-manager](transport-manager.plan.md) | `src/server/transport.ts` | COMPLETED |
| 9 | [registry-listener](registry-listener.plan.md) | `src/server/listener.ts` | COMPLETED |
| 10 | [public-api](public-api.plan.md) | `src/index.ts` | COMPLETED |
| 11 | [cli](cli.plan.md) | `src/cli.ts` | COMPLETED |

## Dependency Graph

```
schema-converter ─────┬──► openai-converter ──► public-api ──► cli
annotation-mapper ────┤                              ▲
id-normalizer ────────┘                              │
error-mapper ──► execution-router ──► server-factory ┘
                                          ▲
                                          │
                                   registry-listener
                                          ▲
                                          │
                                   transport-manager
```

## Architecture

```
src/
├── index.ts              # Public API: serve(), toOpenaiTools()
├── cli.ts                # CLI entry point
├── types.ts              # TypeScript interfaces
├── adapters/
│   ├── schema.ts         # JSON Schema $ref inlining
│   ├── annotations.ts    # Module annotations -> MCP hints
│   ├── errors.ts         # Error sanitization
│   └── idNormalizer.ts   # Dot-notation <-> dash-notation
├── converters/
│   └── openai.ts         # OpenAI tool definition converter
└── server/
    ├── factory.ts        # MCP Server creation & handler registration
    ├── router.ts         # Tool call execution routing
    ├── transport.ts      # Transport lifecycle (stdio/HTTP/SSE)
    └── listener.ts       # Dynamic registry event listener
```

## Progress

- **Total features:** 11
- **Completed:** 11
- **Partial:** 0
- **Test coverage:** 96%+ (110 tests across 10 suites)
