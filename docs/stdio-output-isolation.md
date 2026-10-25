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

`APCoreMCP.serve()` reserves stdout before lazy Registry construction/discovery
and its approval-store lifecycle. The CLI reserves ordinary JavaScript stdout after help/argument parsing and before
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
EOF, explicit close, stdin/protocol errors and termination signals close the
transport first, allowing the MCP SDK to abort handler signals and reject pending
elicitation/sampling requests. Managed handlers and queued protocol writes then
settle before restoration. A response is not promised after a peer disconnects. Session task cancellation is awaited. Startup
failure and normal shutdown both restore stdout; the broader `serve()` cleanup also
restores console methods and stops its store/listener. Cleanup callbacks execute
while the outer reservation still owns stdout.

## Supported boundary

Covered while the owner is active: ordinary `console.log/info/debug`, held Console
objects that use the same process stdout stream, and `process.stdout.write`,
including core/toolkit diagnostics and managed tool/resource handlers. SDK request
signals reach the core CancelToken, including already-aborted requests; listeners
are removed after execution. The factory
tracks handler promises through public `setRequestHandler` registration; EOF waits
for them even when execution is asynchronous. Native Writable backpressure and
write-callback failures propagate to the transport lifecycle.

Node has no portable public `dup`/`dup2` API. This is JavaScript stream isolation,
not operating-system descriptor isolation. It cannot capture `fs.writeSync(1, ...)`,
native code writing fd 1, child processes inheriting fd 1, replacement stdout
streams, or a bound original stdout write function saved before reservation.
Configure those producers to stderr or explicitly pipe and forward child output.
Output before entry or after the owned lifetime is the host's responsibility.
Published apcore-js 0.32.2 has an additional upstream lifecycle defect: `cancel()`
marks tasks CANCELLED without joining their worker, and `shutdown()` joins only
records still PENDING/RUNNING. Its executor also races cancellation against the
underlying module promise. Consequently delayed module cleanup can outlive shutdown.
The companion core fix adds `CancelToken.drain()` backed by private tracking across
child/ancestor scopes, joins all physical task workers (including reclaimed records),
and joins in-flight reaper sweeps. Cancel/deadline responses remain prompt.

The bridge feature-detects `drain()` and registers its promise with the owning
stdio request's lease, without awaiting it in the router or delaying timeout
responses. EOF closes the protocol first, aborts request/peer waits, then joins the
registered physical cleanup before restoring stdout. Unrelated HTTP handlers are
excluded through server-specific ownership and request-local storage.

Full protection for delayed core module/async-worker finalizers requires the
companion core fix to be released and installed. With published 0.32.2, ordinary
stream isolation and cooperative request abort work, but hidden module promises
remain an explicit upstream limitation. No dependency version or absolute local
path is committed while the patched core is unpublished. Tests use a packed local
core artifact; `APCORE_TEST_EXECUTION_DRAIN=1` is a fixture-only mode that requires
the new capability and exercises delayed asynchronous finalizers. It fails clearly
when that capability is absent; this is not a production flag.

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
delayed tool. Class-based lazy discovery has its own real-process regression. `tests/server/stdio-output.test.ts` covers write overloads, callbacks,
backpressure, drain forwarding, nested/concurrent ownership, sequential claims,
work drain and failure restoration. Serve/config/transport regressions cover setup
failure, HTTP/SSE behavior, Config-selected HTTP and asynchronous task cancellation.

Verification on Node 26.0.0:

| Installed core | Focused bridge regressions | Full bridge suite |
| --- | --- | --- |
| Published apcore-js 0.32.2 | 42 passed | 959 passed, one existing failure |
| Companion core fix, packed locally, drain-required mode | 42 passed | 959 passed, one existing failure |

Both full runs executed all conformance fixtures with zero skipped tests. The one
failure (`keeps deeply nested JSON payloads from causing projection stack failures`)
reproduces on clean base commit `6fd4f8555614cb59a73cdaa68b1af8fc54b7ed31`
with identical dependencies/runtime; it is unrelated to output isolation. Bridge
typecheck/build passed; lint reported zero errors and 95 existing warnings. The
required-drain fixture mode was also verified to reject the published core clearly.

The companion core suite passed 257 files and 5,517 tests, with 38 pre-existing
explicit contract-gap skips and no missing conformance fixtures. Coverage is
95.72% lines/statements, 92.05% branches, 97.9% functions; the new internal execution
lifetime module has 100% coverage. Core typecheck/build passed and lint reported
zero errors (71 existing warnings). Sandboxed localhost runs produced `EPERM` and
were rerun with localhost access; they are not treated as skipped coverage.
