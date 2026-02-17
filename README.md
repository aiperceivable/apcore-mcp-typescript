<div align="center">
  <img src="https://raw.githubusercontent.com/aipartnerup/apcore-mcp/main/apcore-mcp-logo.svg" alt="apcore-mcp logo" width="200"/>
</div>

# apcore-mcp

Automatic MCP Server & OpenAI Tools Bridge for [apcore](https://github.com/aipartnerup/apcore).

Converts apcore module registries into [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tool definitions and [OpenAI-compatible function calling](https://platform.openai.com/docs/guides/function-calling) formats — zero boilerplate required.

## Features

- **MCP Server** — Expose apcore modules as MCP tools over stdio, Streamable HTTP, or SSE
- **OpenAI Tools** — Convert modules to OpenAI function calling format with strict mode support
- **Schema Conversion** — Inline `$defs`/`$ref` from Pydantic-generated JSON Schema
- **Annotation Mapping** — Map module annotations to MCP hints and OpenAI description suffixes
- **Error Mapping** — Sanitize internal errors for safe client-facing responses
- **Dynamic Registration** — Listen for registry changes and update tools at runtime
- **CLI** — Launch an MCP server from the command line

## Requirements

- Node.js >= 18.0.0
- apcore (peer dependency)

## Installation

```bash
npm install apcore-mcp
```

## Quick Start

### Programmatic API

```typescript
import { serve, toOpenaiTools } from "apcore-mcp";

// Launch MCP server over stdio
await serve(executor);

// Launch over Streamable HTTP
await serve(executor, {
  transport: "streamable-http",
  host: "127.0.0.1",
  port: 8000,
});

// Export OpenAI tool definitions
const tools = toOpenaiTools(registry, {
  embedAnnotations: true,
  strict: true,
});
```

### CLI

```bash
# stdio (default)
npx apcore-mcp --extensions-dir ./extensions

# Streamable HTTP
npx apcore-mcp --extensions-dir ./extensions --transport streamable-http --port 8000

# SSE
npx apcore-mcp --extensions-dir ./extensions --transport sse --port 8000
```

#### CLI Arguments

| Argument | Default | Description |
|---|---|---|
| `--extensions-dir` | *(required)* | Path to apcore extensions directory |
| `--transport` | `stdio` | `stdio`, `streamable-http`, or `sse` |
| `--host` | `127.0.0.1` | Host for HTTP transports |
| `--port` | `8000` | Port for HTTP transports (1-65535) |
| `--name` | `apcore-mcp` | MCP server name |
| `--version` | package version | MCP server version |
| `--log-level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

## API Reference

### `serve(registryOrExecutor, options?)`

Launch an MCP Server that exposes all apcore modules as tools.

```typescript
function serve(
  registryOrExecutor: Registry | Executor,
  options?: {
    transport?: "stdio" | "streamable-http" | "sse";
    host?: string;
    port?: number;
    name?: string;
    version?: string;
  }
): Promise<void>;
```

### `toOpenaiTools(registryOrExecutor, options?)`

Export apcore modules as OpenAI-compatible tool definitions.

```typescript
function toOpenaiTools(
  registryOrExecutor: Registry | Executor,
  options?: {
    embedAnnotations?: boolean;
    strict?: boolean;
    tags?: string[];
    prefix?: string;
  }
): OpenAIToolDef[];
```

**Options:**

- `embedAnnotations` — Append annotation metadata to tool descriptions (default: `false`)
- `strict` — Enable OpenAI strict mode: adds `additionalProperties: false`, makes all properties required, wraps optional properties with nullable (default: `false`)
- `tags` — Filter modules by tags
- `prefix` — Filter modules by ID prefix

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

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build
npm run build

# Watch mode
npm run dev
```

## Testing

100 tests across 10 test suites with 96%+ line coverage:

| Module | Coverage |
|---|---|
| annotations.ts | 100% |
| idNormalizer.ts | 100% |
| factory.ts | 100% |
| router.ts | 100% |
| errors.ts | 98.8% |
| schema.ts | 97.0% |
| openai.ts | 91.7% |
| listener.ts | 89.7% |

## License

Apache-2.0
