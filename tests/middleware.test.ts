/**
 * Tests for middleware exposure — builder + resolveExecutor wiring.
 *
 * Mirrors tests/test_middleware.py in the Python bridge.
 */

import { describe, expect, it, vi } from "vitest";
import { resolveExecutor } from "../src/index.js";
import { buildMiddlewareFromConfig } from "../src/middleware-builder.js";
import type { Executor, Registry } from "../src/types.js";

// ---------------------------------------------------------------------------
// build-middleware-from-config — unit tests
// ---------------------------------------------------------------------------

describe("buildMiddlewareFromConfig()", () => {
  it("returns empty array for empty input", async () => {
    await expect(buildMiddlewareFromConfig([])).resolves.toEqual([]);
    await expect(buildMiddlewareFromConfig(null)).resolves.toEqual([]);
    await expect(buildMiddlewareFromConfig(undefined)).resolves.toEqual([]);
  });

  it("builds a RetryMiddleware with defaults", async () => {
    const apcore = await import("apcore-js");
    const result = await buildMiddlewareFromConfig([{ type: "retry" }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(apcore.RetryMiddleware);
  });

  it("builds a RetryMiddleware with custom config (snake_case keys)", async () => {
    const apcore = await import("apcore-js");
    const result = await buildMiddlewareFromConfig([
      { type: "retry", max_retries: 5, base_delay_ms: 50 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(apcore.RetryMiddleware);
  });

  it("builds a LoggingMiddleware", async () => {
    const apcore = await import("apcore-js");
    const result = await buildMiddlewareFromConfig([{ type: "logging" }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(apcore.LoggingMiddleware);
  });

  it("builds an ErrorHistoryMiddleware with shorthand keys (snake_case)", async () => {
    const apcore = await import("apcore-js");
    const result = await buildMiddlewareFromConfig([
      {
        type: "error_history",
        max_entries_per_module: 25,
        max_total_entries: 500,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(apcore.ErrorHistoryMiddleware);
  });

  it("preserves order across multiple entries", async () => {
    const apcore = await import("apcore-js");
    const result = await buildMiddlewareFromConfig([
      { type: "retry" },
      { type: "logging" },
    ]);
    expect(result[0]).toBeInstanceOf(apcore.RetryMiddleware);
    expect(result[1]).toBeInstanceOf(apcore.LoggingMiddleware);
  });

  it("throws on unknown type", async () => {
    await expect(
      buildMiddlewareFromConfig([{ type: "bogus" }]),
    ).rejects.toThrow(/unknown type 'bogus'/);
  });

  it("throws on missing type", async () => {
    await expect(
      buildMiddlewareFromConfig([{ maxRetries: 3 } as unknown as { type: string }]),
    ).rejects.toThrow(/missing required 'type' key/);
  });

  it("throws on non-object entry", async () => {
    await expect(
      buildMiddlewareFromConfig(["retry" as unknown as { type: string }]),
    ).rejects.toThrow(/must be an object/);
  });

  it("rejects unknown keys on error_history", async () => {
    await expect(
      buildMiddlewareFromConfig([
        { type: "error_history", bogus_key: true },
      ]),
    ).rejects.toThrow(/unexpected keys: bogus_key/);
  });
});

// ---------------------------------------------------------------------------
// resolveExecutor — middleware wiring
// ---------------------------------------------------------------------------

describe("resolveExecutor() middleware option", () => {
  function makeExecutor(registry: Registry): Executor & { used: unknown[]; use: (mw: unknown) => unknown } {
    return {
      registry,
      call: vi.fn().mockResolvedValue({}),
      used: [] as unknown[],
      use(mw: unknown) {
        (this as unknown as { used: unknown[] }).used.push(mw);
        return this;
      },
    } as unknown as Executor & { used: unknown[]; use: (mw: unknown) => unknown };
  }

  it("applies middleware to a pre-existing Executor in order", async () => {
    const registry: Registry = {
      list: () => [],
      getDefinition: () => null,
      on: vi.fn(),
    };
    const executor = makeExecutor(registry);
    const mw1 = { name: "mw1" };
    const mw2 = { name: "mw2" };

    const result = await resolveExecutor(executor, { middleware: [mw1, mw2] });

    expect(result).toBe(executor);
    expect(executor.used).toEqual([mw1, mw2]);
  });

  it("no-ops when middleware is empty", async () => {
    const registry: Registry = {
      list: () => [],
      getDefinition: () => null,
      on: vi.fn(),
    };
    const executor = makeExecutor(registry);

    await resolveExecutor(executor, { middleware: [] });

    expect(executor.used).toEqual([]);
  });

  it("no-ops when middleware is omitted", async () => {
    const registry: Registry = {
      list: () => [],
      getDefinition: () => null,
      on: vi.fn(),
    };
    const executor = makeExecutor(registry);

    await resolveExecutor(executor);

    expect(executor.used).toEqual([]);
  });

  it("throws when executor has no .use() method", async () => {
    const registry: Registry = {
      list: () => [],
      getDefinition: () => null,
      on: vi.fn(),
    };
    const executor: Executor = {
      registry,
      call: vi.fn(),
    };

    await expect(
      resolveExecutor(executor, { middleware: [{ name: "mw" }] }),
    ).rejects.toThrow(/does not support \.use\(\)/);
  });

  it("applies middleware to a newly-created Executor from a bare Registry", async () => {
    const apcore = await import("apcore-js");
    const registry = new apcore.Registry();
    const mw = new apcore.RetryMiddleware();

    const executor = await resolveExecutor(
      registry as unknown as Registry,
      { middleware: [mw] },
    );

    // Executor should have the retry middleware registered on its manager.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mgr = (executor as any)._middlewareManager;
    expect(mgr).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mws = (mgr as any)._middlewares as unknown[];
    expect(mws).toContain(mw);
  });
});
