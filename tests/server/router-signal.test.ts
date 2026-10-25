import { describe, expect, it, vi } from "vitest";
import { Executor, Registry } from "apcore-js";
import { ExecutionRouter } from "../../src/server/router.js";

describe("MCP request AbortSignal forwarding", () => {
  const makeRouter = () => {
    const called = vi.fn(() => ({ ok: true }));
    const registry = new Registry();
    registry.register("signal.echo", {
      description: "Signal fixture", inputSchema: { type: "object" }, outputSchema: { type: "object" }, execute: called,
    } as never);
    return { router: new ExecutionRouter(Executor.fromRegistry(registry) as never), called };
  };

  it("honors an already-aborted signal before the module starts", async () => {
    const { router, called } = makeRouter();
    const controller = new AbortController();
    controller.abort();
    const [, isError] = await router.handleCall("signal.echo", {}, { signal: controller.signal });
    expect(isError).toBe(true);
    expect(called).not.toHaveBeenCalled();
  });

  it("removes the same request abort listener when execution completes", async () => {
    const { router } = makeRouter();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const [, isError] = await router.handleCall("signal.echo", {}, { signal: controller.signal });
    expect(isError).toBe(false);
    const listener = add.mock.calls.find(([event]) => event === "abort")?.[1];
    expect(listener).toBeTypeOf("function");
    expect(remove).toHaveBeenCalledWith("abort", listener);
  });
});
