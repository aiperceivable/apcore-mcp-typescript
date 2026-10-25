/** Real dependency fixture; run with node --import tsx tests/fixtures/stdio-noise.ts. */
import { Executor, LoggingMiddleware, Registry, StdoutExporter, StdoutSubscriber, TracingMiddleware } from "apcore-js";
import { DisplayResolver } from "apcore-toolkit";
import { serve } from "../../src/index.js";

const registry = new Registry();
registry.register("stdio_noise", {
  description: "Emit ordinary application and dependency diagnostics",
  inputSchema: { type: "object", properties: { fail: { type: "boolean" }, delay: { type: "boolean" } } },
  outputSchema: { type: "object" },
  async execute(inputs: Record<string, unknown>) {
    if (inputs.delay) await new Promise((resolve) => setTimeout(resolve, 40));
    console.log("application console.log");
    process.stdout.write("application stdout.write\n");
    new DisplayResolver().resolve([], { bindingData: { stdio_noise: {} } });
    await new StdoutSubscriber("json").onEvent({
      eventType: "stdio.event", moduleId: "stdio_noise", severity: "info",
      timestamp: "2026-10-25T00:00:00Z", data: { marker: "core subscriber" },
    } as never);
    if (inputs.fail) throw new Error("fixture tool failure");
    return { ok: true };
  },
} as never);
const executor = Executor.fromRegistry(registry);
executor.use(new LoggingMiddleware());
executor.use(new TracingMiddleware(new StdoutExporter()));
await serve(executor as never, {
  transport: "stdio", async: false, dynamic: true,
  onStartup: () => { console.log("startup callback"); },
  onShutdown: () => { console.log("shutdown callback"); },
});
