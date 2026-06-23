import { describe, it, expect, vi } from "vitest";
import { ExecutionRouter } from "../../src/server/router.js";
import type { Executor } from "../../src/types.js";

// Mock apcore-toolkit
vi.mock("apcore-toolkit", () => ({
  formatCsv: (rows: any[]) => {
    if (rows.length === 0) return "";
    const keys = Object.keys(rows[0]);
    return keys.join(",") + "\n" + rows.map(r => keys.map(k => r[k]).join(",")).join("\n") + "\n";
  },
  formatJsonl: (rows: any[]) => rows.map(r => JSON.stringify(r)).join("\n") + "\n",
}));

describe("ExecutionRouter outputFormat", () => {
  it("uses csv formatter when outputFormat='csv'", async () => {
    const result = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ];
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue(result),
    };
    
    const router = new ExecutionRouter(executor, { outputFormat: "csv" });
    const [content, isError] = await router.handleCall("test.tool", {});
    
    expect(isError).toBe(false);
    expect(content[0].text).toContain("id,name");
    expect(content[0].text).toContain("1,Alice");
    expect(content[0].text).toContain("2,Bob");
  });

  it("uses jsonl formatter when outputFormat='jsonl'", async () => {
    const result = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ];
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue(result),
    };
    
    const router = new ExecutionRouter(executor, { outputFormat: "jsonl" });
    const [content, isError] = await router.handleCall("test.tool", {});
    
    expect(isError).toBe(false);
    const lines = content[0].text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(result[0]);
    expect(JSON.parse(lines[1])).toEqual(result[1]);
  });

  it("falls back to JSON for non-tabular data", async () => {
    const result = "simple string";
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue(result),
    };
    
    const router = new ExecutionRouter(executor, { outputFormat: "csv" });
    const [content, isError] = await router.handleCall("test.tool", {});
    
    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify(result));
  });

  it("treats single object as tabular and wraps in array", async () => {
    const result = { id: 1, name: "Alice" };
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue(result),
    };

    const router = new ExecutionRouter(executor, { outputFormat: "csv" });
    const [content, isError] = await router.handleCall("test.tool", {});

    expect(isError).toBe(false);
    expect(content[0].text).toContain("id,name");
    expect(content[0].text).toContain("1,Alice");
  });

  it("treats json as a native JSON.stringify no-op (no toolkit)", async () => {
    const result = [{ id: 1, name: "Alice" }];
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue(result),
    };

    const router = new ExecutionRouter(executor, { outputFormat: "json" });
    const [content, isError] = await router.handleCall("test.tool", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify(result));
  });
});

describe("ExecutionRouter outputFormat fail-fast", () => {
  it("returns an error (not empty output) when csv requested but toolkit missing", async () => {
    // Make the dynamic import of apcore-toolkit fail to simulate a missing dep.
    vi.resetModules();
    vi.doMock("apcore-toolkit", () => {
      throw new Error("Cannot find module 'apcore-toolkit'");
    });

    const { ExecutionRouter: FreshRouter } = await import("../../src/server/router.js");

    const result = [{ id: 1, name: "Alice" }];
    const executor: Executor = {
      registry: {} as any,
      call: vi.fn().mockResolvedValue(result),
    };

    const router = new FreshRouter(executor, { outputFormat: "csv" });
    const [content, isError] = await router.handleCall("test.tool", {});

    // Contract: fail-fast surfaces an error response rather than silently
    // handing back an empty string (the pre-fix sentinel behavior). The error
    // message itself is sanitized by ErrorMapper, so we only assert the
    // error flag and non-empty content.
    expect(isError).toBe(true);
    expect(content[0].text).not.toBe("");

    vi.doUnmock("apcore-toolkit");
    vi.resetModules();
  });
});
