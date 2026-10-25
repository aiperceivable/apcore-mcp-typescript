import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("live HTTP transport output ownership", () => {
  it.each(["streamable-http", "sse"])("keeps %s handler diagnostics on host stdout and leaves stdio available during a real request", async (transport) => {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/http-output.ts", transport], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    try {
      const [code] = await once(child, "close");
      expect(code, stderr).toBe(0);
      for (const marker of ["handler before lease", "handler after lease", "independent stdio lease acquired", "real response verified"]) {
        expect(stdout).toContain(`${transport}: ${marker}`);
        expect(stderr).not.toContain(`${transport}: ${marker}`);
      }
    } finally { child.kill("SIGKILL"); }
  }, 30_000);
});
