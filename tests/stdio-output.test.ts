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
        const timer = setTimeout(() => reject(new Error(`No tool response: ${stdout}\n${stderr}`)), 10_000);
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
      child.kill();
    }
  }, 15_000);
});

describe("stdio CLI bootstrap", () => {
  it("routes configuration, discovery, imported module and startup diagnostics to stderr", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/stdio-cli.ts"], {
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
      for (const marker of ["config bootstrap diagnostic", "discovery bootstrap diagnostic", "extension import diagnostic", "Discovered 1", "Starting MCP server"]) {
        expect(stderr).toContain(marker);
      }
    } finally { child.kill(); }
  }, 15_000);

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
  }, 15_000);
});

describe("stdio EOF while a managed tool is running", () => {
  it("drains the tool and response before shutdown and stdout restoration", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/stdio-noise.ts"], {
      cwd: resolve(import.meta.dirname, ".."), stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const closed = once(child, "close");
    try {
      child.stdin.end(request(1, "initialize", {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "eof", version: "1" },
      }) + request(2, "tools/call", { name: "stdio_noise", arguments: { delay: true } }));
      const [code] = await closed;
      expect(code, stderr).toBe(0);
      const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(messages.find((message) => message.id === 2)?.result.content[0].text).toBe('{"ok":true}');
      expect(stderr.indexOf("application console.log")).toBeLessThan(stderr.indexOf("shutdown callback"));
    } finally { child.kill(); }
  }, 15_000);
});
