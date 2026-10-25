import { CancelToken, Registry, type Context } from "apcore-js";
import { serve } from "../../src/index.js";

const requireDrain = process.env.APCORE_TEST_EXECUTION_DRAIN === "1";
if (requireDrain && typeof (new CancelToken() as CancelToken & { drain?: unknown }).drain !== "function") {
  throw new Error("APCORE_TEST_EXECUTION_DRAIN requires the patched core CancelToken.drain capability");
}
const registry = new Registry();
registry.register("wait_for_abort", {
  description: "Wait cooperatively for real core context cancellation",
  inputSchema: { type: "object" }, outputSchema: { type: "object" },
  async execute(_inputs: Record<string, unknown>, context: Context) {
    console.log("cooperative handler started");
    try {
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) resolve();
        else context.signal.addEventListener("abort", () => { resolve(); }, { once: true });
      });
    } finally {
      if (requireDrain) await new Promise((resolve) => setTimeout(resolve, 40));
      console.log("cooperative handler aborted");
    }
    return {};
  },
} as never);
await serve(registry as never, {
  transport: "stdio", async: false,
  onShutdown: () => { console.log("transport cancellation finished"); },
});
