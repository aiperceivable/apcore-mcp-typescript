# Stdio output isolation

MCP stdio stdout is a JSON-RPC channel. A valid JSON diagnostic (for example a
tracing span or event) is still invalid protocol if it lacks a JSON-RPC envelope.
Changing the logging level alone cannot enforce this contract.

## Assessment

The original bridge printed discovery and startup messages through `console.info`.
`serve()` saved `origInfo`, then used it even when `logLevel` suppressed info.
`runStdio()` returned as soon as the MCP SDK installed stdin listeners. Consequently
`serve()` restored logging and ran shutdown while the server still accepted tools.
Setup failures before the transport's narrow `try` could also leave console methods
suppressed. No transport-level protection covered application stdout.

Defaults and configured integrations differ: bridge warnings already used stderr,
but applications can add apcore-js `LoggingMiddleware`, `StdoutExporter`, and
`StdoutSubscriber`; the latter writes `process.stdout` directly. Toolkit
`DisplayResolver` writes info/debug messages. Tools, startup/shutdown callbacks,
configuration builders, and imported discovery modules can write ordinary stdout.
These are legitimate diagnostics that need routing, not removal. HTTP/SSE have no
stdout protocol and need no such redirection.

## Ownership and lifetime

The exported CLI `main()` starts only when called; importing it has no server
side effect. Direct execution (including symlinked bins) still launches it.

The CLI reserves ordinary JavaScript stdout after help/argument parsing and before
configuration imports, registry construction, discovery, and backend setup. Direct
`serve()` reserves it before Config Bus and middleware setup. When transport is
unspecified, early configuration diagnostics conservatively go to stderr; if Config
Bus selects HTTP/SSE, the reservation ends before backend setup. Explicit HTTP/SSE
and `asyncServe()` install no stdout redirection. Help remains stdout.

The reservation saves the existing `process.stdout.write` and injects a separate
Node `Writable` into the public MCP SDK `StdioServerTransport` constructor. Protocol
writes use the saved function; ordinary stdout writes use stderr. Write overloads,
callbacks, errors, and native Writable buffering are retained. Stderr drain events
are forwarded to stdout while reserved, so diagnostic writers waiting for stdout
`drain` can resume. The forwarding listener and stdout override are removed on
release. Ordinary startup info honors `logLevel`; governance warnings retain their
intentional warning-level bypass.

One process can have one active stdio owner. Nested CLI → serve → transport calls
reuse it through `AsyncLocalStorage`; unrelated owners and concurrent transports
(including sibling tasks inheriting the same owner) fail explicitly. Transport
claims are released for sequential reuse. A stdio reservation affects all ordinary
JavaScript stdout in that process while it is active.

`runStdio()` now waits for transport close, rather than only connection readiness.
EOF drains managed request handlers and protocol writes before closing. Explicit
close, stdin/protocol errors and termination signals close the transport; managed
handlers settle before restoration. Session task cancellation is awaited. Startup
failure and normal shutdown both restore stdout; the broader `serve()` cleanup also
restores console methods and stops its store/listener. Cleanup callbacks execute
while the outer reservation still owns stdout.

## Supported boundary

Covered while the owner is active: ordinary `console.log/info/debug`, held Console
objects that use the same process stdout stream, and `process.stdout.write`,
including core/toolkit diagnostics and managed tool/resource handlers. The factory
tracks handler promises through public `setRequestHandler` registration; EOF waits
for them even when execution is asynchronous. Native Writable backpressure and
write-callback failures propagate to the transport lifecycle.

Node has no portable public `dup`/`dup2` API. This is JavaScript stream isolation,
not operating-system descriptor isolation. It cannot capture `fs.writeSync(1, ...)`,
native code writing fd 1, child processes inheriting fd 1, replacement stdout
streams, or a bound original stdout write function saved before reservation.
Configure those producers to stderr or explicitly pipe and forward child output.
Output before entry or after the owned lifetime is the host's responsibility.
Detached background work, and custom handlers registered on an arbitrary Server
outside `MCPServerFactory`, must be stopped/awaited by their host before close.
Graceful drain can wait indefinitely for a noncooperative managed handler; forced
process termination naturally bypasses JavaScript cleanup.

## Evidence

`tests/stdio-output.test.ts` launches real Node subprocesses with apcore-js 0.32.2,
apcore-toolkit 0.14.0, and MCP SDK 1.26.0. It parses every stdout line as JSON-RPC
through initialize/list/call, tool failure, malformed input, EOF and shutdown; checks
core tracing/events/logging, toolkit output and callbacks on stderr; covers real
CLI discovery/configuration/import diagnostics and help; and closes stdin during a
delayed tool. `tests/server/stdio-output.test.ts` covers write overloads, callbacks,
backpressure, drain forwarding, nested/concurrent ownership, sequential claims,
work drain and failure restoration. Serve/config/transport regressions cover setup
failure, HTTP/SSE behavior, Config-selected HTTP and asynchronous task cancellation.

Verification on Node 26.0.0: the focused CLI/transport/lease/subprocess run passed
68 tests; typecheck and build passed, and lint reported zero errors (95 existing
warnings). The full suite ran all conformance fixtures with localhost permission:
945 passed and one failed (`keeps deeply nested JSON payloads from causing
projection stack failures`). The same failure reproduces on clean base commit
`6fd4f8555614cb59a73cdaa68b1af8fc54b7ed31` with identical dependencies/runtime;
it is unrelated to output isolation. Sandboxed localhost runs produced `EPERM`
and were rerun with localhost access; they are not treated as code failures or
skipped coverage.
