import { describe, it, expect, vi } from "vitest";
import { CancelToken, ExecutionRouter } from "../../src/server/router.js";
import type { HandleCallExtra } from "../../src/server/router.js";
import type { Executor } from "../../src/types.js";
import { MCP_PROGRESS_KEY, MCP_ELICIT_KEY } from "../../src/helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockExecutor(
  result?: Record<string, unknown>,
  error?: Error,
): Executor {
  return {
    registry: {} as any,
    call: error
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue(result ?? {}),
  };
}

function makeModuleError(
  message: string,
  code: string,
  details: Record<string, unknown> | null = null,
): Error & { code: string; details: Record<string, unknown> | null } {
  const error = new Error(message) as Error & {
    code: string;
    details: Record<string, unknown> | null;
  };
  error.code = code;
  error.details = details;
  return error;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionRouter", () => {
  // TC-ROUTER-001
  it("returns successful result with text content and isError=false", async () => {
    const result = { summary: "Hello world", score: 0.95 };
    const executor = createMockExecutor(result);
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall("text.summarize", {
      text: "Hello world",
    });

    expect(isError).toBe(false);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe(JSON.stringify(result));
    expect(traceId).toBeUndefined();

    // [A-D-001] context is now always a BridgeContext (so cancelToken reaches modules)
    expect(executor.call).toHaveBeenCalledWith(
      "text.summarize",
      { text: "Hello world" },
      expect.objectContaining({ cancelToken: expect.any(CancelToken) }),
      undefined,
    );
  });

  // TC-ROUTER-002
  it("returns error content for MODULE_NOT_FOUND error", async () => {
    const error = makeModuleError(
      "Module not found: test.module",
      "MODULE_NOT_FOUND",
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Module not found");
    expect(traceId).toBeUndefined();
  });

  // TC-ROUTER-003
  it("returns formatted error for SCHEMA_VALIDATION_ERROR", async () => {
    const error = makeModuleError(
      "Schema validation failed",
      "SCHEMA_VALIDATION_ERROR",
      {
        errors: [
          { field: "name", message: "is required" },
          { field: "age", message: "must be an integer" },
        ],
      },
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Schema validation failed");
    expect(content[0].text).toContain("name");
    expect(content[0].text).toContain("is required");
    expect(traceId).toBeUndefined();
  });

  // TC-ROUTER-004
  it("returns 'Access denied' for ACL_DENIED error", async () => {
    const error = makeModuleError(
      "ACL check failed for module",
      "ACL_DENIED",
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].text).toBe("Access denied");
    expect(traceId).toBeUndefined();
  });

  // TC-ROUTER-005
  it("returns 'Internal error occurred' for internal error codes", async () => {
    const error = makeModuleError(
      "Depth exceeded",
      "CALL_DEPTH_EXCEEDED",
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].text).toBe("Internal error occurred");
    expect(traceId).toBeUndefined();
  });

  // TC-ROUTER-006
  it("returns 'Internal error occurred' for unknown/unexpected errors", async () => {
    // A plain Error without code/details properties
    const error = new Error("Something unexpected happened");
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].text).toBe("Internal error occurred");
    expect(traceId).toBeUndefined();
  });

  // TC-ROUTER-007
  it("passes empty arguments object to executor", async () => {
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall("test.module", {});

    expect(isError).toBe(false);
    expect(traceId).toBeUndefined();
    // [A-D-001] context is now always a BridgeContext carrying the cancelToken.
    expect(executor.call).toHaveBeenCalledWith(
      "test.module",
      {},
      expect.objectContaining({ cancelToken: expect.any(CancelToken) }),
      undefined,
    );
  });

  // TC-ROUTER-008: context has _mcp_progress when progressToken + sendNotification present
  it("builds context with _mcp_progress when progressToken and sendNotification present", async () => {
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    const extra: HandleCallExtra = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
      _meta: { progressToken: "tok-1" },
    };

    // Non-streaming executor → goes to call path
    await router.handleCall("test.module", {}, extra);

    // executor.call should receive a context with _mcp_progress in data
    const callArgs = (executor.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe("test.module");
    expect(callArgs[1]).toEqual({});
    const context = callArgs[2] as { data: Record<string, unknown> };
    expect(context).toBeDefined();
    expect(typeof context.data[MCP_PROGRESS_KEY]).toBe("function");
  });

  // TC-ROUTER-009: context has _mcp_elicit when sendRequest present
  it("builds context with _mcp_elicit when sendRequest present", async () => {
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    const extra: HandleCallExtra = {
      sendRequest: vi.fn().mockResolvedValue({ action: "accept" }),
    };

    await router.handleCall("test.module", {}, extra);

    const callArgs = (executor.call as ReturnType<typeof vi.fn>).mock.calls[0];
    const context = callArgs[2] as { data: Record<string, unknown> };
    expect(context).toBeDefined();
    expect(typeof context.data[MCP_ELICIT_KEY]).toBe("function");
  });

  // TC-ROUTER-010: no context when no extra provided (backward compat)
  it("passes BridgeContext with cancelToken even when no extra provided", async () => {
    // [A-D-001] Pre-fix this test asserted `context === undefined` for vanilla
    // calls. Post-fix the router always builds a BridgeContext so the cancel
    // token reaches modules even on calls with no MCP envelope.
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    await router.handleCall("test.module", {});

    expect(executor.call).toHaveBeenCalledWith(
      "test.module",
      {},
      expect.objectContaining({ cancelToken: expect.any(CancelToken) }),
      undefined,
    );
  });

  // TC-ROUTER-011: elicit callback sends elicitation/create request
  it("elicit callback sends elicitation/create request via sendRequest", async () => {
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockImplementation(async (_id, _inputs, ctx) => {
        // Simulate module calling elicit
        const elicitFn = ctx.data[MCP_ELICIT_KEY] as Function;
        const result = await elicitFn("Continue?", { type: "object" });
        return { elicitResult: result };
      }),
    };

    const sendRequest = vi.fn().mockResolvedValue({ action: "accept", content: { ok: true } });
    const router = new ExecutionRouter(executor);

    const extra: HandleCallExtra = {
      sendRequest,
    };

    const [content, isError, traceId] = await router.handleCall("test.module", {}, extra);

    expect(isError).toBe(false);
    expect(sendRequest).toHaveBeenCalledTimes(1);
    const [request] = sendRequest.mock.calls[0];
    expect(request.method).toBe("elicitation/create");
    expect(request.params.message).toBe("Continue?");
    expect(request.params.requestedSchema).toEqual({ type: "object" });
  });

  // TC-ROUTER-AI-GUIDANCE-001: error with AI guidance fields appends JSON to text
  it("appends AI guidance JSON to error text when guidance fields present", async () => {
    const error = makeModuleError(
      "Module timed out",
      "APPROVAL_TIMEOUT",
    );
    // Add AI guidance fields
    (error as Record<string, unknown>).retryable = true;
    (error as Record<string, unknown>).aiGuidance = "Try again later";

    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content[0].text).toContain("Module timed out");
    expect(content[0].text).toContain('"retryable":true');
    expect(content[0].text).toContain('"aiGuidance":"Try again later"');
  });

  // TC-ROUTER-AI-GUIDANCE-002: error without AI guidance has plain message
  it("returns plain error message when no AI guidance fields present", async () => {
    const error = makeModuleError(
      "Module not found: test.module",
      "MODULE_NOT_FOUND",
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    // Should not contain JSON appendix
    expect(content[0].text).toBe("Module not found: test.module");
    expect(content[0].text).not.toContain("{");
  });

  // TC-ROUTER-012: progress callback sends notifications/progress
  it("progress callback sends notifications/progress via sendNotification", async () => {
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockImplementation(async (_id, _inputs, ctx) => {
        // Simulate module calling reportProgress
        const progressFn = ctx.data[MCP_PROGRESS_KEY] as Function;
        await progressFn(5, 10, "halfway");
        return { done: true };
      }),
    };

    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const router = new ExecutionRouter(executor);

    const extra: HandleCallExtra = {
      sendNotification,
      _meta: { progressToken: "tok-progress" },
    };

    const [content, isError, traceId] = await router.handleCall("test.module", {}, extra);

    expect(isError).toBe(false);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const notification = sendNotification.mock.calls[0][0] as Record<string, unknown>;
    expect(notification.method).toBe("notifications/progress");
    const params = notification.params as Record<string, unknown>;
    expect(params.progressToken).toBe("tok-progress");
    expect(params.progress).toBe(5);
    expect(params.total).toBe(10);
    expect(params.message).toBe("halfway");
  });

  // [A-D-001] CancelToken must be threaded into the executor's BridgeContext
  // so modules can react to inbound MCP `notifications/cancelled` via
  // `context.cancelToken?.isCancelled`. Pre-fix TS registered the token in
  // _cancelTokens but the BridgeContext.cancelToken was hard-coded to null.
  it("threads cancelToken into the BridgeContext passed to the executor", async () => {
    // Use a deferred promise to keep the executor in-flight while we cancel,
    // so the cancel-token map entry is still live when router.cancel runs.
    let resolveExec!: (v: Record<string, unknown>) => void;
    const execPromise = new Promise<Record<string, unknown>>((r) => {
      resolveExec = r;
    });
    let capturedContext: any = null;
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockImplementation(
        (_moduleId: string, _input: unknown, ctx: unknown) => {
          capturedContext = ctx;
          return execPromise;
        },
      ),
    };
    const router = new ExecutionRouter(executor);
    const extra: HandleCallExtra = { callId: "call-cancel-1" };
    const callPromise = router.handleCall("demo.module", {}, extra);

    // Yield to let _handleCallInner run so capturedContext is populated.
    await Promise.resolve();
    await Promise.resolve();
    expect(capturedContext).not.toBeNull();
    expect(capturedContext.cancelToken).toBeInstanceOf(CancelToken);
    expect(capturedContext.cancelToken.isCancelled).toBe(false);

    // Cancel WHILE the executor is still in-flight; assert the SAME token
    // in the captured context flips to isCancelled = true.
    const cancelled = router.cancel("call-cancel-1");
    expect(cancelled).toBe(true);
    expect(capturedContext.cancelToken.isCancelled).toBe(true);

    resolveExec({});
    await callPromise;
  });

  // [A-D-001] child() preserves the cancelToken so cooperative cancel
  // propagates to nested module invocations.
  it("BridgeContext.child() preserves the cancelToken", async () => {
    let capturedContext: any = null;
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockImplementation(
        async (_moduleId: string, _input: unknown, ctx: unknown) => {
          capturedContext = ctx;
          return {};
        },
      ),
    };
    const router = new ExecutionRouter(executor);
    await router.handleCall("demo.module", {}, { callId: "call-child-1" });
    const child = capturedContext.child("nested.module");
    expect(child.cancelToken).toBe(capturedContext.cancelToken);
  });
});

// ---------------------------------------------------------------------------
// outputFormatter tests
// ---------------------------------------------------------------------------

describe("ExecutionRouter outputFormatter", () => {
  it("uses outputFormatter for dict results when provided", async () => {
    const result = { name: "Alice", score: 95 };
    const executor = createMockExecutor(result);
    const formatter = vi.fn((r: Record<string, unknown>) => `Name: ${r.name}, Score: ${r.score}`);
    const router = new ExecutionRouter(executor, { outputFormatter: formatter });

    const [content, isError] = await router.handleCall("test.tool", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe("Name: Alice, Score: 95");
    expect(formatter).toHaveBeenCalledWith(result);
  });

  it("falls back to JSON.stringify when outputFormatter throws", async () => {
    const result = { value: 42 };
    const executor = createMockExecutor(result);
    const formatter = vi.fn(() => { throw new Error("format failed"); });
    const router = new ExecutionRouter(executor, { outputFormatter: formatter });

    const [content, isError] = await router.handleCall("test.tool", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify(result));
    expect(formatter).toHaveBeenCalled();
  });

  it("does not apply outputFormatter to non-object results", async () => {
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue([1, 2, 3]),
    };
    const formatter = vi.fn(() => "should not be called");
    const router = new ExecutionRouter(executor, { outputFormatter: formatter });

    const [content, isError] = await router.handleCall("test.tool", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify([1, 2, 3]));
    expect(formatter).not.toHaveBeenCalled();
  });

  it("does not apply outputFormatter to null results", async () => {
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue(null),
    };
    const formatter = vi.fn(() => "should not be called");
    const router = new ExecutionRouter(executor, { outputFormatter: formatter });

    const [content, isError] = await router.handleCall("test.tool", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe("null");
    expect(formatter).not.toHaveBeenCalled();
  });

  it("uses JSON.stringify by default when no outputFormatter", async () => {
    const result = { key: "value" };
    const executor = createMockExecutor(result);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.tool", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify(result));
  });

  // TC-ROUTER-VERSIONHINT-001: forwards versionHint from extra._meta.apcore.version
  it("forwards versionHint from request _meta.apcore.version", async () => {
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    await router.handleCall("test.module", { a: 1 }, {
      _meta: { apcore: { version: "2.1.0" } },
    });

    expect(executor.call).toHaveBeenCalledWith(
      "test.module",
      { a: 1 },
      expect.objectContaining({ cancelToken: expect.any(CancelToken) }),
      "2.1.0",
    );
  });

  // TC-ROUTER-VERSIONHINT-002: falls back to descriptor.metadata.versionHint
  it("uses descriptor.metadata.versionHint when extra does not provide one", async () => {
    const executor: Executor = {
      registry: {
        getDefinition: vi.fn().mockReturnValue({
          moduleId: "test.module",
          description: "",
          inputSchema: {},
          outputSchema: {},
          annotations: null,
          metadata: { versionHint: "1.4.0" },
        }),
      } as any,
      call: vi.fn().mockResolvedValue({ ok: true }),
    };
    const router = new ExecutionRouter(executor);

    await router.handleCall("test.module", {});

    expect(executor.call).toHaveBeenCalledWith(
      "test.module",
      {},
      expect.objectContaining({ cancelToken: expect.any(CancelToken) }),
      "1.4.0",
    );
  });
});
