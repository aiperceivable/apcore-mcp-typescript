import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function request(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

describe("real stdio protocol output isolation", () => {
  it("keeps startup, execution, core/toolkit logs, errors and shutdown off protocol stdout", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/stdio-noise.ts"], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const closed = once(child, "close");
    try {
      child.stdin.write(request(1, "initialize", {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "regression", version: "1" },
      }));
      child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      child.stdin.write(request(2, "tools/list"));
      child.stdin.write(request(3, "tools/call", { name: "stdio_noise", arguments: {} }));
      child.stdin.write(request(4, "tools/call", { name: "stdio_noise", arguments: { fail: true } }));
      // Wait for runtime calls before closing stdin; EOF must run shutdown cleanup.
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => reject(new Error(`No tool response: ${stdout}\n${stderr}`)), 30_000);
        const poll = () => {
          if (!stdout.includes('"id":4')) return;
          clearTimeout(timer); child.stdout.off("data", poll); done();
        };
        child.stdout.on("data", poll); poll();
      });
      child.stdin.write("invalid-json\n");
      child.stdin.end();
      const [code] = await closed;
      expect(code, stderr).toBe(0);
      const lines = stdout.trim().split("\n");
      const messages = lines.map((line) => JSON.parse(line));
      expect(messages.every((message) => message.jsonrpc === "2.0"), stdout).toBe(true);
      expect(messages.find((message) => message.id === 3)?.result.isError).not.toBe(true);
      expect(messages.find((message) => message.id === 4)?.error).toBeDefined();
      for (const marker of ["Starting MCP server", "startup callback", "shutdown callback", "application console.log", "application stdout.write", "DisplayResolver", "core subscriber", "START stdio_noise", '"traceId"']) {
        expect(stderr, marker).toContain(marker);
      }
    } finally {
      child.kill("SIGKILL");
    }
  }, 45_000);
});

describe("stdio CLI bootstrap", () => {
  it.each([
    { fixture: "stdio-cli.ts", markers: ["config bootstrap diagnostic", "discovery bootstrap diagnostic", "extension import diagnostic", "Discovered 1", "Starting MCP server"] },
    { fixture: "stdio-class.ts", markers: ["extension import diagnostic", "Starting MCP server"] },
  ])("routes $fixture bootstrap/import diagnostics to stderr", async ({ fixture, markers }) => {
    const child = spawn(process.execPath, ["--import", "tsx", `tests/fixtures/${fixture}`], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    const closed = once(child, "close");
    try {
      child.stdin.end(request(1, "initialize", {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cli-regression", version: "1" },
      }) + request(2, "tools/list"));
      const [code] = await closed;
      expect(code, stderr).toBe(0);
      const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
      expect(messages.find((message) => message.id === 2)?.result.tools).toHaveLength(1);
      for (const marker of markers) {
        expect(stderr).toContain(marker);
      }
    } finally { child.kill("SIGKILL"); }
  }, 45_000);

  it("keeps help output on stdout outside an active server lifetime", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "--help"], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const [code] = await once(child, "close");
    expect(code, stderr).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stderr).toBe("");
  }, 45_000);
});

describe("stdio EOF while a managed tool is running", () => {
  it("holds stdout until the running handler settles after disconnect", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/stdio-delayed.ts"], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const closed = once(child, "close");
    try {
      child.stdin.write(request(1, "initialize", {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "eof", version: "1" },
      }) + request(2, "tools/call", { name: "stdio_noise", arguments: { delay: true } }));
      await new Promise<void>((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error(`tool did not start: ${stderr}`)), 30_000);
        const observe = () => {
          if (!stderr.includes("delayed tool started")) return;
          clearTimeout(timer); child.stderr.off("data", observe); resolveReady();
        };
        child.stderr.on("data", observe); observe();
      });
      child.stdin.end();
      const [code] = await closed;
      expect(code, stderr).toBe(0);
      const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
      expect(stderr).toContain("application console.log");
      expect(stderr).toContain("shutdown callback");
      expect(stderr.indexOf("application console.log")).toBeLessThan(stderr.indexOf("shutdown callback"));
    } finally { child.kill("SIGKILL"); }
  }, 45_000);
});

describe("cooperative handler cancellation", () => {
  it.each([
    { fixture: "stdio-cancellation.ts", shutdown: "EOF" },
    { fixture: "stdio-cancellation.ts", shutdown: "SIGTERM" },
    { fixture: "stdio-core-cancellation.ts", shutdown: "EOF" },
    { fixture: "stdio-core-cancellation.ts", shutdown: "SIGTERM" },
  ])("aborts $fixture peer waits before draining on $shutdown", async ({ fixture, shutdown }) => {
    const child = spawn(process.execPath, ["--import", "tsx", `tests/fixtures/${fixture}`], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const closed = once(child, "close");
    try {
      child.stdin.write(request(1, "initialize", {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cancel", version: "1" },
      }) + request(2, "tools/call", { name: "wait_for_abort", arguments: {} }));
      await new Promise<void>((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error(`handler did not start: ${stderr}`)), 30_000);
        closed.finally(() => { clearTimeout(timer); reject(new Error(`server exited before handler start: ${stderr}`)); }).catch(() => {});
        const observe = () => {
          if (!stderr.includes("cooperative handler started")) return;
          clearTimeout(timer); child.stderr.off("data", observe); resolveReady();
        };
        child.stderr.on("data", observe); observe();
      });
      if (shutdown === "EOF") child.stdin.end();
      else child.kill("SIGTERM");
      const [code] = await Promise.race([
        closed,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`cooperative shutdown deadlocked: ${stderr}`)), 3_000);
          closed.finally(() => clearTimeout(timer)).catch(() => {});
        }),
      ]);
      expect(code, stderr).toBe(0);
      expect(stderr).toContain("cooperative handler aborted");
      expect(stderr).toContain("transport cancellation finished");
      expect(stdout.trim().split("\n").every((line) => JSON.parse(line).jsonrpc === "2.0")).toBe(true);
    } finally { child.kill("SIGKILL"); }
  }, 45_000);
});

describe("MCP deadline response and physical cleanup ownership", () => {
  it("responds before deferred finalization, then joins it before releasing stdout", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/stdio-timeout.ts"], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const closed = once(child, "close");
    try {
      child.stdin.write(request(1, "initialize", {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "deadline", version: "1" },
      }) + request(2, "tools/call", { name: "wait_for_deadline", arguments: {} }));
      await new Promise<void>((resolveResponse, reject) => {
        const timer = setTimeout(() => reject(new Error(`deadline response waited for finalization: ${stderr}`)), 30_000);
        const observe = () => {
          if (!stdout.includes('"id":2')) return;
          clearTimeout(timer); child.stdout.off("data", observe); resolveResponse();
        };
        closed.finally(() => { clearTimeout(timer); reject(new Error(`server exited: ${stderr}`)); }).catch(() => {});
        child.stdout.on("data", observe); observe();
      });
      if (process.env.APCORE_TEST_EXECUTION_DRAIN === "1") expect(stderr).not.toContain("timeout module cleaned");
      child.stdin.end('{"jsonrpc":"2.0","method":"test/releaseCleanup"}\n');
      const [code] = await closed;
      expect(code, stderr).toBe(0);
      const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
      expect(messages.find((message) => message.id === 2)?.error).toBeDefined();
      expect(stderr).toContain("timeout module cleaned");
      expect(stderr.indexOf("timeout module cleaned")).toBeLessThan(stderr.indexOf("timeout shutdown"));
    } finally { child.kill("SIGKILL"); }
  }, 45_000);
});
