<div align="center">
  <img src="https://raw.githubusercontent.com/aiperceivable/apcore-mcp/main/apcore-mcp-logo.svg" alt="apcore-mcp logo" width="200"/>
</div>

# apcore-mcp

Automatic MCP Server & OpenAI Tools Bridge for [apcore](https://github.com/aiperceivable/apcore).

Converts apcore module registries into [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tool definitions and [OpenAI-compatible function calling](https://platform.openai.com/docs/guides/function-calling) formats — zero boilerplate required.

## Features

- **MCP Server** — Expose apcore modules as MCP tools over stdio, Streamable HTTP, or SSE
- **OpenAI Tools** — Convert modules to OpenAI function calling format with strict mode support
- **Schema Conversion** — Inline `$defs`/`$ref` from Pydantic-generated JSON Schema
- **Annotation Mapping** — Map module annotations to MCP hints and OpenAI description suffixes
- **Approval Mechanism** — Built-in elicitation-based approval flow for sensitive tool executions
- **Error Mapping** — Sanitize internal errors for safe client-facing responses
- **Dynamic Registration** — Listen for registry changes and update tools at runtime
- **Tool Explorer** — Browser-based UI for browsing schemas and testing tools interactively
- **CLI** — Launch an MCP server from the command line

## Documentation

For full documentation, including Quick Start guides for both Python and TypeScript, visit:
**[https://aiperceivable.github.io/apcore-mcp/](https://aiperceivable.github.io/apcore-mcp/)**

## Requirements

- Node.js >= 18.0.0

## Installation

```bash
npm install apcore-mcp
```

`apcore-js` is included as a direct dependency — no separate install needed.

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
| `--explorer` | off | Enable the browser-based Tool Explorer UI (HTTP only) |
| `--explorer-prefix` | `/explorer` | URL prefix for the explorer UI |
| `--allow-execute` | off | Allow tool execution from the explorer UI |
| `--jwt-secret` | — | JWT secret key for Bearer token authentication |
| `--jwt-algorithm` | `HS256` | JWT algorithm |
| `--jwt-audience` | — | Expected JWT audience claim |
| `--jwt-issuer` | — | Expected JWT issuer claim |
| `--jwt-require-auth` | `true` | Require auth (use `--no-jwt-require-auth` for permissive mode) |
| `--exempt-paths` | `/health,/metrics` | Comma-separated paths exempt from auth |

JWT key resolution priority: `--jwt-secret` > `APCORE_JWT_SECRET` environment variable.

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "apcore": {
      "command": "npx",
      "args": ["apcore-mcp", "--extensions-dir", "/path/to/your/extensions"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "apcore": {
      "command": "npx",
      "args": ["apcore-mcp", "--extensions-dir", "./extensions"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "apcore": {
      "command": "npx",
      "args": ["apcore-mcp", "--extensions-dir", "./extensions"]
    }
  }
}
```

### Remote HTTP access

```bash
npx apcore-mcp --extensions-dir ./extensions \
    --transport streamable-http \
    --host 0.0.0.0 \
    --port 9000
```

Connect any MCP client to `http://your-host:9000/mcp`.

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
    dynamic?: boolean;
    validateInputs?: boolean;
    tags?: string[] | null;
    prefix?: string | null;
    logLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
    onStartup?: () => void | Promise<void>;
    onShutdown?: () => void | Promise<void>;
    metricsCollector?: MetricsExporter;
    explorer?: boolean;
    explorerPrefix?: string;
    allowExecute?: boolean;
    authenticator?: Authenticator;
    exemptPaths?: string[];
    approvalHandler?: unknown;
    explorerTitle?: string;
    explorerProjectName?: string;
    explorerProjectUrl?: string;
    requireAuth?: boolean;
    outputFormatter?: (result: Record<string, unknown>) => string;
  }
): Promise<void>;
```

**Additional options:**

- `explorerTitle` — Custom title for the Tool Explorer UI page
- `explorerProjectName` — Project name shown in the explorer UI footer
- `explorerProjectUrl` — Project URL shown in the explorer UI footer
- `requireAuth` — If `true` (default), unauthenticated requests are rejected with 401. Set to `false` for permissive mode
- `outputFormatter` — Custom function to format tool execution results. When undefined, results are serialized with `JSON.stringify(result)`

### `asyncServe(registryOrExecutor, options?)`

Embed the MCP server into a larger Node.js HTTP application. Returns an HTTP request handler and a close function for lifecycle management.

```typescript
import { asyncServe } from "apcore-mcp";

const { handler, close } = await asyncServe(executor, {
  name: "apcore-mcp",
  explorer: true,
  allowExecute: true,
});

// Mount in a custom HTTP server
const server = http.createServer(handler);
server.listen(8000);

// Clean up when done
await close();
```

Accepts the same options as `serve()` except `transport`, `host`, `port`, `onStartup`, and `onShutdown`.

### Tool Explorer

When `explorer: true` is passed to `serve()`, a browser-based Tool Explorer UI is mounted on HTTP transports. It provides an interactive page for browsing tool schemas and testing tool execution.

```typescript
await serve(registry, {
  transport: "streamable-http",
  explorer: true,
  allowExecute: true,
});
// Open http://127.0.0.1:8000/explorer/ in a browser
```

**Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /explorer/` | Interactive HTML page (self-contained, no external dependencies) |
| `GET /explorer/tools` | JSON array of all tools with name, description, annotations |
| `GET /explorer/tools/<name>` | Full tool detail with inputSchema |
| `POST /explorer/tools/<name>/call` | Execute a tool (requires `allowExecute: true`) |

- **HTTP transports only** (`streamable-http`, `sse`). Silently ignored for `stdio`.
- **Execution disabled by default** — set `allowExecute: true` to enable Try-it.
- **Custom prefix** — use `explorerPrefix: "/browse"` to mount at a different path.
- **Authorization UI** — Swagger-UI-style Authorization input field. Paste a Bearer token to authenticate tool execution requests. Generated cURL commands automatically include the Authorization header.

### JWT Authentication

apcore-mcp supports JWT Bearer token authentication for HTTP-based transports.

#### Programmatic Usage

```typescript
import { serve, JWTAuthenticator } from "apcore-mcp";

const authenticator = new JWTAuthenticator({
  secret: "your-secret-key",
  algorithms: ["HS256"],
  audience: "my-app",
  issuer: "auth-service",
  // Map custom claims to Identity fields
  claimMapping: {
    id: "sub",
    type: "type",
    roles: "roles",
    attrs: ["email", "org"],  // Extra claims → Identity.attrs
  },
  // Claims that must be present in the token (default: ["sub"])
  requireClaims: ["sub", "email"],
  // Set to false for permissive mode (allow unauthenticated requests)
  requireAuth: true,
});

await serve(executor, {
  transport: "streamable-http",
  authenticator,
  // Custom exempt paths (default: ["/health", "/metrics"])
  exemptPaths: ["/health", "/metrics", "/status"],
});
```

#### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--jwt-secret` | — | JWT secret key for Bearer token authentication |
| `--jwt-algorithm` | `HS256` | JWT algorithm |
| `--jwt-audience` | — | Expected audience claim |
| `--jwt-issuer` | — | Expected issuer claim |
| `--jwt-require-auth` | `true` | Require auth. Use `--no-jwt-require-auth` for permissive mode |
| `--exempt-paths` | `/health,/metrics` | Comma-separated paths exempt from auth |

JWT key resolution priority: `--jwt-secret` > `APCORE_JWT_SECRET` environment variable.

#### curl Examples

```bash
# Authenticated request
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Health check (always exempt)
curl http://localhost:8000/health
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

### `reportProgress(context, progress, total?, message?)`

Report execution progress to the MCP client. No-ops silently when called outside an MCP context (no callback injected).

```typescript
import { reportProgress } from "apcore-mcp";

// Inside a module's execute() method:
await reportProgress(context, 5, 10, "Processing item 5 of 10");
```

**Parameters:**

- `context` — Object with a `data` dict (apcore Context or BridgeContext)
- `progress` — Current progress value
- `total` — Optional total for percentage calculation
- `message` — Optional human-readable progress message

### `elicit(context, message, requestedSchema?)`

Ask the MCP client for user input via the elicitation protocol. Returns `null` when called outside an MCP context.

```typescript
import { elicit } from "apcore-mcp";
import type { ElicitResult } from "apcore-mcp";

// Inside a module's execute() method:
const result: ElicitResult | null = await elicit(
  context,
  "Are you sure you want to proceed?",
  {
    type: "object",
    properties: {
      confirmed: { type: "boolean", description: "Confirm action" },
    },
    required: ["confirmed"],
  },
);

if (result?.action === "accept") {
  // User confirmed
}
```

**Parameters:**

- `context` — Object with a `data` dict (apcore Context or BridgeContext)
- `message` — Message to display to the user
- `requestedSchema` — Optional JSON Schema describing the expected input

**Returns:** `ElicitResult` with `action` (`"accept"`, `"decline"`, or `"cancel"`) and optional `content`, or `null` if not in an MCP context.

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

## License

Apache-2.0
