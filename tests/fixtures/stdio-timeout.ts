import { CancelToken, Registry, type Context } from "apcore-js";
import { serve } from "../../src/index.js";
const requireDrain = process.env.APCORE_TEST_EXECUTION_DRAIN === "1";
if (requireDrain && typeof (new CancelToken() as CancelToken & { drain?: unknown }).drain !== "function") {
  throw new Error("APCORE_TEST_EXECUTION_DRAIN requires the patched core CancelToken.drain capability");
}
let releaseCleanup!: () => void;
const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
const releaseFromPeer = (chunk: Buffer) => {
  if (chunk.toString().includes('"test/releaseCleanup"')) releaseCleanup();
};
process.stdin.on("data", releaseFromPeer);
const registry = new Registry();
registry.register("wait_for_deadline", {
  description: "Timeout promptly while finalization remains owned", resources: { timeout: 30 },
  inputSchema: { type: "object" }, outputSchema: { type: "object" },
  async execute(_inputs: Record<string, unknown>, context: Context) {
    try {
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) resolve();
        else context.signal.addEventListener("abort", () => { resolve(); }, { once: true });
      });
    } finally {
      if (requireDrain) await cleanup;
      console.log("timeout module cleaned");
    }
    return {};
  },
} as never);
try {
  await serve(registry as never, {
    transport: "stdio", async: false,
    onShutdown: () => { console.log("timeout shutdown"); },
  });
} finally { process.stdin.off("data", releaseFromPeer); }
