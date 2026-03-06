import { describe, it, expect, vi } from "vitest";
import { ExecutionRouter } from "../../src/server/router.js";
import type { HandleCallExtra } from "../../src/server/router.js";
import type { Executor } from "../../src/types.js";
import { MCP_PROGRESS_KEY } from "../../src/helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock executor with an optional stream() that yields the given chunks.
 */
function createStreamingExecutor(
  chunks: Record<string, unknown>[],
  callResult?: Record<string, unknown>,
): Executor {
  return {
    registry: {} as any,
    call: vi.fn().mockResolvedValue(callResult ?? {}),
    async *stream(
      _moduleId: string,
      _inputs: Record<string, unknown>,
      _context?: unknown,
    ): AsyncGenerator<Record<string, unknown>> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

/**
 * Create a mock executor without stream() — only call().
 */
function createNonStreamingExecutor(
  result?: Record<string, unknown>,
): Executor {
  return {
    registry: {} as any,
    call: vi.fn().mockResolvedValue(result ?? {}),
  };
}

/**
 * Create a HandleCallExtra with a mock sendNotification and a progressToken.
 */
function createExtra(progressToken?: string | number): HandleCallExtra & {
  sendNotification: ReturnType<typeof vi.fn>;
} {
  return {
    sendNotification: vi.fn().mockResolvedValue(undefined),
    _meta: progressToken !== undefined ? { progressToken } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionRouter — streaming", () => {
  // TC-STREAM-001: Streams chunks via sendNotification when progressToken provided
  it("streams chunks via sendNotification when progressToken is provided", async () => {
    const chunks = [
      { partial: "chunk-0" },
      { partial: "chunk-1" },
      { partial: "chunk-2" },
    ];
    const executor = createStreamingExecutor(chunks);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-123");

    const [content, isError, traceId] = await router.handleCall(
      "test.stream",
      { input: "hello" },
      extra,
    );

    // Should not be an error
    expect(isError).toBe(false);

    // sendNotification should have been called once per chunk
    expect(extra.sendNotification).toHaveBeenCalledTimes(3);

    // Each notification should be a notifications/progress with the correct progressToken
    for (let i = 0; i < 3; i++) {
      const notification = extra.sendNotification.mock.calls[i][0] as Record<
        string,
        unknown
      >;
      expect(notification.method).toBe("notifications/progress");
      const params = notification.params as Record<string, unknown>;
      expect(params.progressToken).toBe("tok-123");
      expect(params.progress).toBe(i + 1);
      expect(params.message).toBe(JSON.stringify(chunks[i]));
    }

    // Final result should be shallow merge of all chunks (same key = last wins)
    // Content has 1 item: result only (trace_id returned as 3rd tuple element)
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text)).toEqual({ partial: "chunk-2" });
    // trace_id returned as separate element
    expect(traceId).toBeDefined();

    // call() should NOT have been invoked
    expect(executor.call).not.toHaveBeenCalled();
  });

  // TC-STREAM-002: Shallow merge accumulates disjoint keys
  it("shallow-merges chunks with disjoint keys", async () => {
    const chunks = [
      { alpha: 1 },
      { beta: 2 },
      { gamma: 3 },
    ];
    const executor = createStreamingExecutor(chunks);
    const router = new ExecutionRouter(executor);
    const extra = createExtra(42);

    const [content, isError, traceId] = await router.handleCall(
      "test.merge",
      {},
      extra,
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual({
      alpha: 1,
      beta: 2,
      gamma: 3,
    });
    // trace_id returned as 3rd tuple element, not appended to content
    expect(content).toHaveLength(1);
    expect(traceId).toBeDefined();
  });

  // TC-STREAM-003: Falls back to call() when executor has no stream()
  it("falls back to call() when executor has no stream()", async () => {
    const result = { answer: 42 };
    const executor = createNonStreamingExecutor(result);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-fallback");

    const [content, isError, traceId] = await router.handleCall(
      "test.nostream",
      { q: "?" },
      extra,
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual(result);

    // sendNotification should NOT have been called (for streaming chunks)
    // Note: it may be used for explicit progress via context callback
    expect(extra.sendNotification).not.toHaveBeenCalled();

    // call() should have been invoked with context (has progress callback)
    const callArgs = (executor.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe("test.nostream");
    expect(callArgs[1]).toEqual({ q: "?" });
    // Context should exist because extra has sendNotification + progressToken
    expect(callArgs[2]).toBeDefined();
    expect(typeof callArgs[2].data[MCP_PROGRESS_KEY]).toBe("function");

    // trace_id returned as 3rd tuple element (context was created)
    expect(content).toHaveLength(1);
    expect(traceId).toBeDefined();
  });

  // TC-STREAM-004: Falls back to call() when no progressToken provided
  it("falls back to call() when no progressToken is provided", async () => {
    const chunks = [{ partial: "ignored" }];
    const callResult = { full: "result" };
    const executor = createStreamingExecutor(chunks, callResult);
    const router = new ExecutionRouter(executor);

    // Extra without _meta / progressToken
    const extra: HandleCallExtra = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
    };

    const [content, isError, traceId] = await router.handleCall(
      "test.noprogress",
      {},
      extra,
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual(callResult);

    // sendNotification should NOT have been called
    expect(extra.sendNotification).not.toHaveBeenCalled();

    // call() should have been invoked — no progressToken means no context callbacks
    expect(executor.call).toHaveBeenCalledWith("test.noprogress", {}, undefined);
  });

  // TC-STREAM-005: Falls back to call() when no extra provided at all
  it("falls back to call() when no extra is provided", async () => {
    const chunks = [{ partial: "ignored" }];
    const callResult = { full: "result" };
    const executor = createStreamingExecutor(chunks, callResult);
    const router = new ExecutionRouter(executor);

    const [content, isError, traceId] = await router.handleCall(
      "test.noextra",
      {},
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual(callResult);
    expect(traceId).toBeUndefined();
    expect(executor.call).toHaveBeenCalledWith("test.noextra", {}, undefined);
  });

  // TC-STREAM-006: Numeric progressToken works
  it("accepts numeric progressToken", async () => {
    const chunks = [{ status: "done" }];
    const executor = createStreamingExecutor(chunks);
    const router = new ExecutionRouter(executor);
    const extra = createExtra(99);

    const [content, isError, traceId] = await router.handleCall(
      "test.numeric",
      {},
      extra,
    );

    expect(isError).toBe(false);
    expect(extra.sendNotification).toHaveBeenCalledTimes(1);

    const notification = extra.sendNotification.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const params = notification.params as Record<string, unknown>;
    expect(params.progressToken).toBe(99);
    // 1-based progress
    expect(params.progress).toBe(1);
    // trace_id returned as 3rd tuple element
    expect(content).toHaveLength(1);
    expect(traceId).toBeDefined();
  });

  // TC-STREAM-007: Empty stream returns empty accumulated object
  it("returns empty object when stream yields no chunks", async () => {
    const executor = createStreamingExecutor([]);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-empty");

    const [content, isError, traceId] = await router.handleCall(
      "test.empty",
      {},
      extra,
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual({});
    expect(extra.sendNotification).not.toHaveBeenCalled();
    // trace_id returned as 3rd tuple element (context was created even though no chunks streamed)
    expect(content).toHaveLength(1);
    expect(traceId).toBeDefined();
  });

  // TC-STREAM-008: Context with _mcp_progress is passed to stream()
  it("passes context with _mcp_progress to executor.stream()", async () => {
    let receivedContext: unknown = null;
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue({}),
      async *stream(
        _moduleId: string,
        _inputs: Record<string, unknown>,
        context?: unknown,
      ): AsyncGenerator<Record<string, unknown>> {
        receivedContext = context;
        yield { done: true };
      },
    };

    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-ctx");

    await router.handleCall("test.ctx", {}, extra);

    expect(receivedContext).toBeDefined();
    const ctx = receivedContext as { data: Record<string, unknown> };
    expect(typeof ctx.data[MCP_PROGRESS_KEY]).toBe("function");
  });

  // TC-STREAM-009: Deep merge accumulates nested objects
  it("deep-merges nested objects in streaming chunks", async () => {
    const chunks = [
      { result: { status: "pending", details: { step: 1 } } },
      { result: { details: { step: 2, extra: "info" } } },
    ];
    const executor = createStreamingExecutor(chunks);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-deep");

    const [content, isError] = await router.handleCall("test.deep", {}, extra);

    expect(isError).toBe(false);
    const parsed = JSON.parse(content[0].text);
    // Deep merge: result.status preserved, details merged
    expect(parsed).toEqual({
      result: { status: "pending", details: { step: 2, extra: "info" } },
    });
  });

  // TC-STREAM-010: Deep merge overwrites non-object values
  it("overwrites non-object values during deep merge", async () => {
    const chunks = [
      { count: 1, nested: { a: "original" } },
      { count: 2, nested: { b: "new" } },
    ];
    const executor = createStreamingExecutor(chunks);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-overwrite");

    const [content, isError] = await router.handleCall("test.overwrite", {}, extra);

    expect(isError).toBe(false);
    const parsed = JSON.parse(content[0].text);
    expect(parsed.count).toBe(2); // scalar overwritten
    expect(parsed.nested).toEqual({ a: "original", b: "new" }); // nested merged
  });

  // TC-STREAM-012: Deep merge falls back to shallow at depth >= 32
  it("falls back to shallow merge at depth boundary (32)", async () => {
    // Build a structure 33 levels deep: { a: { a: { ... { a: { deep: "v1" } } } } }
    function buildDeep(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
      let obj = leaf;
      for (let i = 0; i < depth; i++) {
        obj = { a: obj };
      }
      return obj;
    }
    // At depth 33, the innermost merge should be shallow (overwrite, not recurse)
    const chunk1 = buildDeep(33, { deep: "v1", keep: "original" });
    const chunk2 = buildDeep(33, { deep: "v2" });

    const executor = createStreamingExecutor([chunk1, chunk2]);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-depth");

    const [content, isError] = await router.handleCall("test.depth", {}, extra);

    expect(isError).toBe(false);
    const parsed = JSON.parse(content[0].text);
    // Navigate to the leaf (33 levels deep)
    let node: Record<string, unknown> = parsed;
    for (let i = 0; i < 33; i++) {
      node = node.a as Record<string, unknown>;
    }
    // At depth >= 32, shallow merge overwrites the entire leaf object
    // so "keep" should NOT be preserved (shallow overwrite)
    expect(node.deep).toBe("v2");
    expect(node.keep).toBeUndefined();
  });

  // TC-STREAM-011: Deep merge handles arrays by overwriting (not merging)
  it("overwrites arrays during deep merge", async () => {
    const chunks = [
      { items: [1, 2, 3] },
      { items: [4, 5] },
    ];
    const executor = createStreamingExecutor(chunks);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-arr");

    const [content, isError] = await router.handleCall("test.array", {}, extra);

    expect(isError).toBe(false);
    const parsed = JSON.parse(content[0].text);
    expect(parsed.items).toEqual([4, 5]); // array overwritten, not merged
  });
});
