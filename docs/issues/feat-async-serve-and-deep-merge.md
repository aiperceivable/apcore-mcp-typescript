# Feature: asyncServe API and Deep Merge for Streaming

**Commit:** 2d927ea67954aefc4d696302ed2cdef19a1c410f

### Problem
The library only provided a `serve()` function that always created its own HTTP server, making it difficult to embed MCP functionality into existing web applications (e.g., Express or Fastify). Additionally, streaming tool results used shallow merging, which corrupted nested object structures in subsequent chunks. There was also no specialized handling for execution cancellation.

### Why it needs to be fixed
Modern web architectures often require mounting multiple services onto a single port. An embeddable handler API is essential for these scenarios. Furthermore, as tools become more complex, reliable streaming of nested data and proper handling of user-initiated cancellation are critical for a robust user experience.

### How it was resolved
1.  **asyncServe API**: Implemented `asyncServe()` which returns a Node.js-compatible `(req, res) => Promise<void>` handler and a `close` function, allowing for easy mounting into any HTTP server.
2.  **Deep Merge Logic**: Implemented a recursive `deepMerge` function (with a safety depth limit of 32) to correctly accumulate streaming chunks containing nested objects.
3.  **Cancellation Handling**: Enhanced `ErrorMapper` to detect `ExecutionCancelledError` and return a standard `EXECUTION_CANCELLED` error response with `retryable: true`.
4.  **Auth Overrides**: Added a top-level `requireAuth` option to `TransportManager` to allow overriding the authenticator's default behavior (permissive mode).

### How it was verified
1.  **Embedding Tests**: Added tests in `tests/api.test.ts` verifying that `asyncServe` returns the correct interface and successfully handles requests like `/health`.
2.  **Streaming Accuracy**: Added `tests/server/test-router-stream.test.ts` with test cases for deep-merging nested objects, overwriting scalars, and depth-limit safety.
3.  **Cancellation Tests**: Added unit tests in `tests/adapters/errors.test.ts` ensuring that both constructor-name and code-based cancellation errors are correctly mapped.
