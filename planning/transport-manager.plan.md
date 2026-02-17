# Implementation Plan: Transport Manager

## Feature
transport-manager

## Target
`src/server/transport.ts`

## Status: COMPLETED

## Dependencies
- `@modelcontextprotocol/sdk` (Server, StdioServerTransport, StreamableHTTPServerTransport, SSEServerTransport)
- `node:http` (createServer)

## Implementation Tasks

### Task 1: Create TransportManager class skeleton
- **Status:** Done
- **File:** `src/server/transport.ts`
- **Details:** Export class with `runStdio()`, `runStreamableHttp()`, `runSse()`, `close()` methods, `_validateHostPort()` internal helper, and `httpServer` property.

### Task 2: Implement `_validateHostPort()`
- **Status:** Done
- **Details:** Validate host is non-empty string, port is integer between 1 and 65535. Throw `Error` with descriptive messages on failure.

### Task 3: Implement `runStdio()`
- **Status:** Done
- **Details:** Create `StdioServerTransport` from MCP SDK, call `server.connect(transport)`. Fully functional.

### Task 4: Implement `runStreamableHttp()`
- **Status:** Done
- **Details:** Creates `StreamableHTTPServerTransport` with session ID generator. Connects transport to MCP server. Creates Node.js HTTP server that routes requests to the endpoint through `transport.handleRequest()`, with JSON body parsing for POST/DELETE. Non-endpoint paths return 404. Resolves when server starts listening.

### Task 5: Implement `runSse()`
- **Status:** Done
- **Details:** Creates Node.js HTTP server with two endpoints: GET on SSE endpoint establishes SSE connection via `SSEServerTransport`, POST on `/messages` routes to `transport.handlePostMessage()` with session lookup. Tracks transports per session with cleanup on close. Non-endpoint paths return 404. Missing/unknown session returns 400.

## TDD Test Cases
- **File:** `tests/server/transport.test.ts`
- **Status:** 18 tests passing
- TC-TRANSPORT-VALIDATE-001: Accepts valid host and port
- TC-TRANSPORT-VALIDATE-002: Accepts port 1 (minimum)
- TC-TRANSPORT-VALIDATE-003: Accepts port 65535 (maximum)
- TC-TRANSPORT-VALIDATE-004: Rejects empty host
- TC-TRANSPORT-VALIDATE-005: Rejects port 0
- TC-TRANSPORT-VALIDATE-006: Rejects port above 65535
- TC-TRANSPORT-VALIDATE-007: Rejects negative port
- TC-TRANSPORT-VALIDATE-008: Rejects non-integer port
- TC-TRANSPORT-HTTP-001: Connects transport to server and starts HTTP listener
- TC-TRANSPORT-HTTP-002: Returns 404 for non-endpoint paths
- TC-TRANSPORT-HTTP-003: Routes POST to /mcp endpoint to transport
- TC-TRANSPORT-HTTP-004: Uses custom endpoint when specified
- TC-TRANSPORT-SSE-001: Starts HTTP server and listens
- TC-TRANSPORT-SSE-002: Returns 404 for non-endpoint paths
- TC-TRANSPORT-SSE-003: POST to /messages without session returns 400
- TC-TRANSPORT-SSE-004: Uses custom endpoint when specified
- TC-TRANSPORT-CLOSE-001: Closes the HTTP server
- TC-TRANSPORT-CLOSE-002: Safe to call when no server is running
