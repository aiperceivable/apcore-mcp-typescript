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
});
