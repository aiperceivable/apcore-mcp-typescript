/**
 * Tests for Feature 3: validateInputs in ExecutionRouter
 *
 * Verifies that:
 * - When validateInputs=true and executor.validate() returns errors, an error response is returned
 * - When validateInputs=true and executor.validate() returns empty, execution proceeds
 * - When validateInputs=false, validation is skipped entirely
 * - When executor lacks validate(), validation is skipped even if validateInputs=true
 * - When executor.validate() throws, the error is caught and returned
 */

import { describe, it, expect, vi } from "vitest";
import { ExecutionRouter } from "../../src/server/router.js";
import type { Executor } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockExecutor(opts?: {
  result?: Record<string, unknown>;
  validateResult?: string[] | Promise<string[]>;
  validateThrows?: Error;
}): Executor {
  const executor: Executor = {
    registry: {} as any,
    call: vi.fn().mockResolvedValue(opts?.result ?? { ok: true }),
  };

  if (opts?.validateThrows) {
    executor.validate = vi.fn().mockRejectedValue(opts.validateThrows);
  } else if (opts?.validateResult !== undefined) {
    executor.validate = vi.fn().mockResolvedValue(opts.validateResult);
  }
  // If neither, executor.validate is undefined (no validate method)

  return executor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionRouter validateInputs (F3)", () => {
  it("returns validation error when validateInputs=true and validate() returns errors", async () => {
    const executor = createMockExecutor({
      validateResult: ["name: is required", "age: must be a number"],
    });
    const router = new ExecutionRouter(executor, { validateInputs: true });

    const [content, isError] = await router.handleCall("test.module", { foo: "bar" });

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].text).toContain("Validation failed");
    expect(content[0].text).toContain("name: is required");
    expect(content[0].text).toContain("age: must be a number");

    // executor.call should NOT have been called
    expect(executor.call).not.toHaveBeenCalled();

    // executor.validate should have been called with correct args
    expect(executor.validate).toHaveBeenCalledWith("test.module", { foo: "bar" });
  });

  it("proceeds with execution when validateInputs=true and validate() returns empty array", async () => {
    const executor = createMockExecutor({
      result: { computed: 42 },
      validateResult: [],
    });
    const router = new ExecutionRouter(executor, { validateInputs: true });

    const [content, isError] = await router.handleCall("test.module", { x: 1 });

    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify({ computed: 42 }));
    expect(executor.validate).toHaveBeenCalledTimes(1);
    expect(executor.call).toHaveBeenCalledTimes(1);
  });

  it("skips validation entirely when validateInputs=false", async () => {
    const executor = createMockExecutor({
      result: { done: true },
      validateResult: ["this should not matter"],
    });
    const router = new ExecutionRouter(executor, { validateInputs: false });

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify({ done: true }));
    // validate should NOT have been called
    expect(executor.validate).not.toHaveBeenCalled();
    expect(executor.call).toHaveBeenCalledTimes(1);
  });

  it("skips validation when validateInputs is not set (defaults to false)", async () => {
    const executor = createMockExecutor({
      result: { done: true },
      validateResult: ["error"],
    });
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(false);
    expect(executor.validate).not.toHaveBeenCalled();
    expect(executor.call).toHaveBeenCalledTimes(1);
  });

  it("skips validation when executor lacks validate() even if validateInputs=true", async () => {
    // No validateResult = no validate method on executor
    const executor = createMockExecutor({
      result: { noValidate: true },
    });
    const router = new ExecutionRouter(executor, { validateInputs: true });

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(false);
    expect(content[0].text).toBe(JSON.stringify({ noValidate: true }));
    expect(executor.call).toHaveBeenCalledTimes(1);
  });

  it("catches and returns error when validate() throws", async () => {
    const executor = createMockExecutor({
      validateThrows: new Error("Validation service unavailable"),
    });
    const router = new ExecutionRouter(executor, { validateInputs: true });

    const [content, isError] = await router.handleCall("test.module", { x: 1 });

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    // The ErrorMapper should produce a message
    expect(content[0].text).toBeTruthy();
    // executor.call should NOT have been called
    expect(executor.call).not.toHaveBeenCalled();
  });

  it("validates with async validate() returning Promise<string[]>", async () => {
    const executor = createMockExecutor({
      validateResult: Promise.resolve(["field: too long"]),
    });
    // Note: the mock already wraps with mockResolvedValue, so it's effectively
    // returning Promise.resolve(["field: too long"]) which itself is a promise
    // that resolves to the array. But since we await the result, it still works.

    // Actually we need to set it up properly:
    executor.validate = vi.fn().mockResolvedValue(["field: too long"]);

    const router = new ExecutionRouter(executor, { validateInputs: true });

    const [content, isError] = await router.handleCall("test.module", { text: "a".repeat(1000) });

    expect(isError).toBe(true);
    expect(content[0].text).toContain("Validation failed");
    expect(content[0].text).toContain("field: too long");
  });
});
