import { describe, it, expect, vi } from "vitest";
import {
  AsyncTaskBridge,
  META_TOOL_NAMES,
  APCORE_META_TOOL_PREFIX,
  type AsyncTaskManagerLike,
} from "../../src/server/async-task-bridge.js";
import { ExecutionRouter } from "../../src/server/router.js";
import { MCPServerFactory } from "../../src/server/factory.js";
import type { Executor, Registry, ModuleDescriptor } from "../../src/types.js";

function buildManager(overrides: Partial<AsyncTaskManagerLike> = {}): AsyncTaskManagerLike {
  const defaults: AsyncTaskManagerLike = {
    submit: vi.fn().mockResolvedValue("task-1"),
    getStatus: vi.fn().mockReturnValue(null),
    getResult: vi.fn().mockReturnValue({}),
    cancel: vi.fn().mockResolvedValue(true),
    listTasks: vi.fn().mockReturnValue([]),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return { ...defaults, ...overrides };
}

function makeDescriptor(overrides: Partial<ModuleDescriptor> = {}): ModuleDescriptor {
  return {
    moduleId: overrides.moduleId ?? "demo.module",
    description: "",
    inputSchema: { type: "object" },
    outputSchema: {},
    annotations: overrides.annotations ?? null,
    metadata: overrides.metadata,
  };
}

describe("AsyncTaskBridge", () => {
  it("isAsyncModule detects metadata.async=true", () => {
    const bridge = new AsyncTaskBridge(buildManager());
    const descriptor = makeDescriptor({ metadata: { async: true } });
    expect(bridge.isAsyncModule(descriptor)).toBe(true);
  });

  it("isAsyncModule detects annotations.extra.mcp_async='true'", () => {
    const bridge = new AsyncTaskBridge(buildManager());
    const descriptor = makeDescriptor({
      annotations: {
        readonly: false,
        destructive: false,
        idempotent: false,
        requiresApproval: false,
        openWorld: false,
        streaming: false,
        extra: { mcp_async: "true" },
      },
    });
    expect(bridge.isAsyncModule(descriptor)).toBe(true);
  });

  it("isAsyncModule returns false when no hint is present", () => {
    const bridge = new AsyncTaskBridge(buildManager());
    expect(bridge.isAsyncModule(makeDescriptor())).toBe(false);
  });

  it("submit() returns task_id envelope with pending status", async () => {
    const manager = buildManager({
      submit: vi.fn().mockResolvedValue("task-xyz"),
    });
    const bridge = new AsyncTaskBridge(manager);
    const envelope = await bridge.submit("demo.module", { a: 1 });
    expect(envelope).toEqual({ task_id: "task-xyz", status: "pending" });
    expect(manager.submit).toHaveBeenCalledWith("demo.module", { a: 1 }, null);
  });

  it("buildMetaTools returns 4 reserved tools", () => {
    const bridge = new AsyncTaskBridge(buildManager());
    const tools = bridge.buildMetaTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      META_TOOL_NAMES.CANCEL,
      META_TOOL_NAMES.LIST,
      META_TOOL_NAMES.STATUS,
      META_TOOL_NAMES.SUBMIT,
    ].sort());
  });

  it("handleMetaTool(__apcore_task_submit) rejects reserved module ids", async () => {
    const bridge = new AsyncTaskBridge(buildManager());
    await expect(
      bridge.handleMetaTool(META_TOOL_NAMES.SUBMIT, {
        module_id: "__apcore_something",
        arguments: {},
      }),
    ).rejects.toThrow(/Reserved module id/);
  });

  // [A-D-008] Regression: __apcore_task_submit on a non-async-hinted
  // module must return ASYNC_MODULE_NOT_ASYNC when a descriptor lookup
  // is wired. Pre-fix TS skipped this check, silently wrapping sync-only
  // modules as async tasks.
  it("handleMetaTool(__apcore_task_submit) rejects non-async modules with ASYNC_MODULE_NOT_ASYNC", async () => {
    const syncDescriptor = {
      moduleId: "sync.module",
      description: "sync only",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object" },
      annotations: null,
      // No metadata.async, no annotations.extra.mcp_async
    };
    const bridge = new AsyncTaskBridge(buildManager(), {
      descriptorLookup: (id: string) => (id === "sync.module" ? syncDescriptor : null),
    });
    await expect(
      bridge.handleMetaTool(META_TOOL_NAMES.SUBMIT, {
        module_id: "sync.module",
        arguments: {},
      }),
    ).rejects.toThrow(/ASYNC_MODULE_NOT_ASYNC/);
  });

  it("handleMetaTool(__apcore_task_submit) accepts async-hinted modules when descriptor-lookup is wired", async () => {
    const asyncDescriptor = {
      moduleId: "async.module",
      description: "async-hinted",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object" },
      annotations: null,
      metadata: { async: true },
    };
    const bridge = new AsyncTaskBridge(buildManager(), {
      descriptorLookup: (id: string) => (id === "async.module" ? asyncDescriptor : null),
    });
    const envelope = await bridge.handleMetaTool(META_TOOL_NAMES.SUBMIT, {
      module_id: "async.module",
      arguments: {},
    });
    expect(envelope).toEqual({ task_id: expect.any(String), status: "pending" });
  });

  it("handleMetaTool(__apcore_task_submit) skips ASYNC_MODULE_NOT_ASYNC when no descriptor-lookup is wired (back-compat)", async () => {
    const bridge = new AsyncTaskBridge(buildManager()); // no descriptorLookup
    const envelope = await bridge.handleMetaTool(META_TOOL_NAMES.SUBMIT, {
      module_id: "any.module",
      arguments: {},
    });
    // Without lookup, the bridge can't enforce the rule — accepts the
    // submit (pre-fix TS behavior, preserved for unit-test ergonomics).
    expect(envelope).toEqual({ task_id: expect.any(String), status: "pending" });
  });

  it("handleMetaTool(__apcore_task_status) inlines completed result and redacts", async () => {
    const manager = buildManager({
      getStatus: vi.fn().mockReturnValue({
        taskId: "t1",
        moduleId: "demo.module",
        status: "completed",
        submittedAt: 0,
        startedAt: 0,
        completedAt: 1,
        result: { secret: "abc", keep: "xyz" },
        error: null,
      }),
    });
    const redact = vi.fn((r: Record<string, unknown>) => ({
      ...r,
      secret: "[REDACTED]",
    }));
    const bridge = new AsyncTaskBridge(manager, {
      redactSensitive: redact,
      outputSchemaMap: {
        "demo.module": { type: "object", properties: { secret: { type: "string" } } },
      },
    });
    const projection = (await bridge.handleMetaTool(META_TOOL_NAMES.STATUS, {
      task_id: "t1",
    })) as Record<string, unknown>;
    expect(projection.status).toBe("completed");
    expect(projection.result).toEqual({ secret: "[REDACTED]", keep: "xyz" });
    expect(redact).toHaveBeenCalled();
  });

  it("handleMetaTool(__apcore_task_status) surfaces error on failure", async () => {
    const manager = buildManager({
      getStatus: vi.fn().mockReturnValue({
        taskId: "t1",
        moduleId: "demo.module",
        status: "failed",
        submittedAt: 0,
        startedAt: 0,
        completedAt: 1,
        result: null,
        error: "boom",
      }),
    });
    const bridge = new AsyncTaskBridge(manager);
    const projection = (await bridge.handleMetaTool(META_TOOL_NAMES.STATUS, {
      task_id: "t1",
    })) as Record<string, unknown>;
    expect(projection.error).toBe("boom");
    expect(projection.status).toBe("failed");
  });

  it("handleMetaTool(__apcore_task_status) throws when task not found", async () => {
    const bridge = new AsyncTaskBridge(buildManager());
    await expect(
      bridge.handleMetaTool(META_TOOL_NAMES.STATUS, { task_id: "gone" }),
    ).rejects.toThrow(/Task not found/);
  });

  it("handleMetaTool(__apcore_task_cancel) returns {task_id, cancelled}", async () => {
    const bridge = new AsyncTaskBridge(buildManager());
    const result = await bridge.handleMetaTool(META_TOOL_NAMES.CANCEL, {
      task_id: "t1",
    });
    expect(result).toEqual({ task_id: "t1", cancelled: true });
  });

  it("handleMetaTool(__apcore_task_list) returns {tasks: []}", async () => {
    const manager = buildManager({
      listTasks: vi.fn().mockReturnValue([
        {
          taskId: "t1",
          moduleId: "demo.module",
          status: "running",
          submittedAt: 1,
          startedAt: 2,
          completedAt: null,
          result: null,
          error: null,
        },
      ]),
    });
    const bridge = new AsyncTaskBridge(manager);
    const result = (await bridge.handleMetaTool(META_TOOL_NAMES.LIST, {})) as {
      tasks: Array<{ task_id: string; status: string }>;
    };
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].task_id).toBe("t1");
    expect(result.tasks[0].status).toBe("running");
  });

  it("disabled bridge reports isAsyncModule=false and empty meta-tools", () => {
    const bridge = new AsyncTaskBridge(buildManager(), { enabled: false });
    expect(bridge.enabled).toBe(false);
    expect(bridge.isMetaTool(META_TOOL_NAMES.SUBMIT)).toBe(false);
    expect(bridge.buildMetaTools()).toEqual([]);
  });

  // [A-D-005] cancelSessionTasks must detach the per-session task list
  // from the map BEFORE iterating cancels. Otherwise a concurrent submit()
  // appends to the same Array reference and the trailing delete drops the
  // newly-tracked task.
  it("cancelSessionTasks: tasks submitted concurrently with cancel are not silently dropped", async () => {
    let submitCounter = 0;
    const manager = buildManager({
      submit: vi.fn().mockImplementation(async () => {
        submitCounter++;
        return `task-${submitCounter}`;
      }),
      cancel: vi.fn().mockImplementation(async (taskId: string) => {
        // Simulate a concurrent submit() racing the cancel iteration.
        // After we cancel task-1, a new submit lands on the same session.
        if (taskId === "task-1") {
          await bridge.submit("demo.module", {}, null, { sessionKey: "sess-A" });
        }
        return true;
      }),
    });
    const bridge = new AsyncTaskBridge(manager);
    await bridge.submit("demo.module", {}, null, { sessionKey: "sess-A" });
    const cancelled = await bridge.cancelSessionTasks("sess-A");
    expect(cancelled).toBe(1);
    // The post-fix behavior: the racing submit went into a fresh entry
    // because the session map was cleared BEFORE the for-of loop ran.
    // Pre-fix: it would have been pushed onto the still-live array
    // referenced by `taskIds`, then silently dropped at the post-loop delete.
    // We assert the new task remains tracked under the session.
    const cancelled2 = await bridge.cancelSessionTasks("sess-A");
    expect(cancelled2).toBe(1);
  });

  // [A-D-009] handleMetaTool CANCEL must drop the progress-token binding
  // so subsequent terminal-state notifications don't fan out to a token
  // whose caller has been told the task is gone.
  it("handleMetaTool(__apcore_task_cancel) drops the progress-token binding", async () => {
    const manager = buildManager({
      submit: vi.fn().mockResolvedValue("task-pt-1"),
      cancel: vi.fn().mockResolvedValue(true),
    });
    const bridge = new AsyncTaskBridge(manager);
    await bridge.submit("demo.module", {}, null, { progressToken: "tok-1" });
    expect(bridge.getProgressToken("task-pt-1")).toBe("tok-1");
    await bridge.handleMetaTool(META_TOOL_NAMES.CANCEL, { task_id: "task-pt-1" });
    expect(bridge.getProgressToken("task-pt-1")).toBeUndefined();
  });
});

describe("ExecutionRouter + AsyncTaskBridge routing", () => {
  function createMockExecutor(
    descriptor: ModuleDescriptor | null,
    result: Record<string, unknown> = {},
  ): Executor {
    return {
      registry: {
        getDefinition: () => descriptor,
      } as unknown as Registry,
      call: vi.fn().mockResolvedValue(result),
    };
  }

  it("routes async-hinted modules to AsyncTaskManager.submit", async () => {
    const descriptor = makeDescriptor({
      moduleId: "demo.module",
      metadata: { async: true },
    });
    const executor = createMockExecutor(descriptor);
    const manager = buildManager({
      submit: vi.fn().mockResolvedValue("task-async"),
    });
    const bridge = new AsyncTaskBridge(manager);
    const router = new ExecutionRouter(executor, { asyncTaskBridge: bridge });

    const [content, isError] = await router.handleCall("demo.module", {
      q: "hello",
    });
    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual({
      task_id: "task-async",
      status: "pending",
    });
    expect(manager.submit).toHaveBeenCalled();
    expect(executor.call).not.toHaveBeenCalled();
  });

  it("intercepts reserved meta-tool calls before executor", async () => {
    const executor = createMockExecutor(null);
    const manager = buildManager({
      submit: vi.fn().mockResolvedValue("task-submitted"),
    });
    const bridge = new AsyncTaskBridge(manager);
    const router = new ExecutionRouter(executor, { asyncTaskBridge: bridge });

    const [content, isError] = await router.handleCall(
      META_TOOL_NAMES.SUBMIT,
      { module_id: "demo.module", arguments: {} },
    );
    expect(isError).toBe(false);
    const payload = JSON.parse(content[0].text) as Record<string, unknown>;
    expect(payload.task_id).toBe("task-submitted");
  });

  it("sync module falls through the async check", async () => {
    const descriptor = makeDescriptor({ moduleId: "plain.module" });
    const executor = createMockExecutor(descriptor, { ok: true });
    const manager = buildManager();
    const bridge = new AsyncTaskBridge(manager);
    const router = new ExecutionRouter(executor, { asyncTaskBridge: bridge });

    const [content, isError] = await router.handleCall("plain.module", {});
    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual({ ok: true });
    expect(manager.submit).not.toHaveBeenCalled();
    expect(executor.call).toHaveBeenCalled();
  });
});

describe("MCPServerFactory + AsyncTaskBridge", () => {
  it("buildTools rejects modules with reserved __apcore_ prefix", () => {
    const registry: Registry = {
      list: () => [`${APCORE_META_TOOL_PREFIX}rogue`],
      getDefinition: () => null,
      on: () => {},
    };
    const factory = new MCPServerFactory();
    expect(() => factory.buildTools(registry)).toThrow(/Reserved module id/);
  });

  it("attachAsyncMetaTools appends 4 meta-tools when bridge is enabled", () => {
    const factory = new MCPServerFactory();
    const bridge = new AsyncTaskBridge(buildManager());
    const tools = factory.attachAsyncMetaTools([], bridge);
    expect(tools).toHaveLength(4);
    expect(new Set(tools.map((t) => t.name))).toEqual(
      new Set([
        META_TOOL_NAMES.SUBMIT,
        META_TOOL_NAMES.STATUS,
        META_TOOL_NAMES.CANCEL,
        META_TOOL_NAMES.LIST,
      ]),
    );
  });
});

// D11-015: Progress sink installation
describe("D11-015: Progress sink installation in submit()", () => {
  it("installs progress sink on context.data when progressToken + sendNotification provided", async () => {
    const manager: AsyncTaskManagerLike = {
      submit: vi.fn().mockResolvedValue("task-123"),
      getStatus: vi.fn(),
      getResult: vi.fn(),
      cancel: vi.fn(),
      listTasks: vi.fn().mockReturnValue([]),
    };
    const bridge = new AsyncTaskBridge(manager);

    const context = { data: {} as Record<string, unknown> };
    const mockSend = vi.fn().mockResolvedValue(undefined);

    await bridge.submit("my.module", {}, context, {
      progressToken: "tok-abc",
      sendNotification: mockSend,
    });

    // The progress sink should now be installed
    expect(typeof context.data["_mcp_progress"]).toBe("function");

    // Invoke the sink and verify it calls sendNotification with correct shape
    const sink = context.data["_mcp_progress"] as (p: number, t: number) => Promise<void>;
    await sink(50, 100);
    expect(mockSend).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: { progressToken: "tok-abc", progress: 50, total: 100 },
    });
  });

  it("does NOT install progress sink when sendNotification is absent", async () => {
    const manager: AsyncTaskManagerLike = {
      submit: vi.fn().mockResolvedValue("task-456"),
      getStatus: vi.fn(),
      getResult: vi.fn(),
      cancel: vi.fn(),
      listTasks: vi.fn().mockReturnValue([]),
    };
    const bridge = new AsyncTaskBridge(manager);
    const context = { data: {} as Record<string, unknown> };

    await bridge.submit("my.module", {}, context, {
      progressToken: "tok-xyz",
      // sendNotification NOT provided
    });

    expect(context.data["_mcp_progress"]).toBeUndefined();
  });
});

// D11-016: _projectTaskInfo only returns the 6 allowed keys + conditional result/error
describe("D11-016: _projectTaskInfo curated projection (no extra field leakage)", () => {
  it("returns only task_id, module_id, status, submitted_at, started_at, completed_at", async () => {
    const manager: AsyncTaskManagerLike = {
      submit: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        taskId: "t1",
        moduleId: "my.module",
        status: "running",
        submittedAt: 1000,
        startedAt: 1001,
        completedAt: null,
        result: null,
        error: null,
        // Extra fields that should NOT appear in the projection
        extraField: "should not leak",
        internalState: { foo: "bar" },
      }),
      getResult: vi.fn(),
      cancel: vi.fn(),
      listTasks: vi.fn().mockReturnValue([]),
    };
    const bridge = new AsyncTaskBridge(manager);

    const result = await bridge.handleMetaTool(META_TOOL_NAMES.STATUS, { task_id: "t1" }) as Record<string, unknown>;

    // Only the 6 allowed fields should be present
    const allowedKeys = new Set(["task_id", "module_id", "status", "submitted_at", "started_at", "completed_at"]);
    for (const key of Object.keys(result)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    expect(result.task_id).toBe("t1");
    expect(result.module_id).toBe("my.module");
    expect(result.status).toBe("running");
    expect(result["extraField"]).toBeUndefined();
    expect(result["internalState"]).toBeUndefined();
  });

  it("adds result field for completed status", async () => {
    const manager: AsyncTaskManagerLike = {
      submit: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        taskId: "t2",
        moduleId: "my.module",
        status: "completed",
        submittedAt: 1000,
        startedAt: 1001,
        completedAt: 1002,
        result: { output: 42 },
        error: null,
      }),
      getResult: vi.fn(),
      cancel: vi.fn(),
      listTasks: vi.fn().mockReturnValue([]),
    };
    const bridge = new AsyncTaskBridge(manager);
    const result = await bridge.handleMetaTool(META_TOOL_NAMES.STATUS, { task_id: "t2" }) as Record<string, unknown>;
    expect(result.result).toEqual({ output: 42 });
    expect(result.error).toBeUndefined();
  });

  it("adds error field for failed status", async () => {
    const manager: AsyncTaskManagerLike = {
      submit: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        taskId: "t3",
        moduleId: "my.module",
        status: "failed",
        submittedAt: 1000,
        startedAt: 1001,
        completedAt: 1002,
        result: null,
        error: "Something went wrong",
      }),
      getResult: vi.fn(),
      cancel: vi.fn(),
      listTasks: vi.fn().mockReturnValue([]),
    };
    const bridge = new AsyncTaskBridge(manager);
    const result = await bridge.handleMetaTool(META_TOOL_NAMES.STATUS, { task_id: "t3" }) as Record<string, unknown>;
    expect(result.error).toBe("Something went wrong");
    expect(result.result).toBeUndefined();
  });
});
