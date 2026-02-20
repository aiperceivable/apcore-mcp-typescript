import { describe, it, expect, vi } from "vitest";
import { ExecutionRouter } from "../../src/server/router.js";
import type { HandleCallExtra } from "../../src/server/router.js";
import type { Executor } from "../../src/types.js";

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

    const [content, isError] = await router.handleCall(
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
      expect(params.progress).toBe(i);
      expect(params.message).toBe(JSON.stringify(chunks[i]));
    }

    // Final result should be shallow merge of all chunks (same key = last wins)
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text)).toEqual({ partial: "chunk-2" });

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

    const [content, isError] = await router.handleCall(
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
  });

  // TC-STREAM-003: Falls back to call() when executor has no stream()
  it("falls back to call() when executor has no stream()", async () => {
    const result = { answer: 42 };
    const executor = createNonStreamingExecutor(result);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-fallback");

    const [content, isError] = await router.handleCall(
      "test.nostream",
      { q: "?" },
      extra,
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual(result);

    // sendNotification should NOT have been called
    expect(extra.sendNotification).not.toHaveBeenCalled();

    // call() should have been invoked
    expect(executor.call).toHaveBeenCalledWith("test.nostream", { q: "?" });
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

    const [content, isError] = await router.handleCall(
      "test.noprogress",
      {},
      extra,
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual(callResult);

    // sendNotification should NOT have been called
    expect(extra.sendNotification).not.toHaveBeenCalled();

    // call() should have been invoked instead of stream()
    expect(executor.call).toHaveBeenCalledWith("test.noprogress", {});
  });

  // TC-STREAM-005: Falls back to call() when no extra provided at all
  it("falls back to call() when no extra is provided", async () => {
    const chunks = [{ partial: "ignored" }];
    const callResult = { full: "result" };
    const executor = createStreamingExecutor(chunks, callResult);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall(
      "test.noextra",
      {},
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual(callResult);
    expect(executor.call).toHaveBeenCalledWith("test.noextra", {});
  });

  // TC-STREAM-006: Numeric progressToken works
  it("accepts numeric progressToken", async () => {
    const chunks = [{ status: "done" }];
    const executor = createStreamingExecutor(chunks);
    const router = new ExecutionRouter(executor);
    const extra = createExtra(99);

    const [content, isError] = await router.handleCall(
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
  });

  // TC-STREAM-007: Empty stream returns empty accumulated object
  it("returns empty object when stream yields no chunks", async () => {
    const executor = createStreamingExecutor([]);
    const router = new ExecutionRouter(executor);
    const extra = createExtra("tok-empty");

    const [content, isError] = await router.handleCall(
      "test.empty",
      {},
      extra,
    );

    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual({});
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });
});
