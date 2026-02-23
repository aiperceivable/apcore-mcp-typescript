/**
 * Tests for the CLI entry point (src/cli.ts).
 *
 * Each test uses vi.resetModules() + dynamic import to get a fresh CLI module
 * load with the appropriate process.argv. process.exit is mocked to record
 * exit codes without actually terminating the process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CLI (cli.ts)", () => {
  const originalArgv = [...process.argv];
  const originalExit = process.exit;

  let tmpDir: string;
  let exitCalls: number[];
  let errorMessages: string[];
  let logMessages: string[];
  let infoMessages: string[];
  let warnMessages: string[];

  beforeEach(() => {
    vi.resetModules();

    exitCalls = [];
    errorMessages = [];
    logMessages = [];
    infoMessages = [];
    warnMessages = [];

    tmpDir = mkdtempSync(join(tmpdir(), "apcore-cli-test-"));

    // Mock process.exit to record the code without terminating
    process.exit = ((code?: number) => {
      exitCalls.push(code ?? 0);
    }) as never;

    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorMessages.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logMessages.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      infoMessages.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnMessages.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exit = originalExit;
    vi.restoreAllMocks();
    try {
      rmdirSync(tmpDir);
    } catch {
      // ignore cleanup errors
    }
  });

  /**
   * Helper: set process.argv, mock serve/VERSION, dynamically import cli.ts.
   * The module's top-level `main()` call executes automatically on import.
   *
   * Since process.exit is mocked to NOT terminate, code may continue past
   * fail() calls — we always check exitCalls[0] for the first exit.
   */
  async function runCli(args: string[]) {
    process.argv = ["node", "cli.js", ...args];

    vi.doMock("../src/index.js", () => ({
      serve: vi.fn().mockResolvedValue(undefined),
      VERSION: "0.0.0-test",
    }));

    try {
      await import("../src/cli.js");
    } catch {
      // Swallow errors from auto-executing main()
    }
    // Wait for async main() to settle
    await new Promise((r) => setTimeout(r, 200));

    return { exitCalls, errorMessages, logMessages, infoMessages, warnMessages };
  }

  // ── Help ────────────────────────────────────────────────────────────────

  it("prints help and exits 0 with --help", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCalls[0]).toBe(0);
    expect(result.logMessages.some((m) => m.includes("apcore-mcp"))).toBe(true);
    expect(
      result.logMessages.some((m) => m.includes("--extensions-dir")),
    ).toBe(true);
  });

  // ── Argument validation ────────────────────────────────────────────────

  it("fails when --extensions-dir is missing", async () => {
    const result = await runCli([]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) =>
        m.includes("--extensions-dir is required"),
      ),
    ).toBe(true);
  });

  it("fails when --extensions-dir path does not exist", async () => {
    const result = await runCli([
      "--extensions-dir",
      "/nonexistent/path/12345",
    ]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) => m.includes("does not exist")),
    ).toBe(true);
  });

  it("fails for invalid --transport", async () => {
    const result = await runCli([
      "--extensions-dir",
      tmpDir,
      "--transport",
      "websocket",
    ]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) =>
        m.includes("--transport must be one of"),
      ),
    ).toBe(true);
  });

  it("fails for out-of-range --port", async () => {
    const result = await runCli([
      "--extensions-dir",
      tmpDir,
      "--port",
      "99999",
    ]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) => m.includes("--port must be in range")),
    ).toBe(true);
  });

  it("fails for non-numeric --port", async () => {
    const result = await runCli([
      "--extensions-dir",
      tmpDir,
      "--port",
      "abc",
    ]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) => m.includes("--port must be in range")),
    ).toBe(true);
  });

  it("fails for --name exceeding 255 characters", async () => {
    const longName = "a".repeat(256);
    const result = await runCli([
      "--extensions-dir",
      tmpDir,
      "--name",
      longName,
    ]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) =>
        m.includes("--name must be at most 255"),
      ),
    ).toBe(true);
  });

  // ── Unknown flags ──────────────────────────────────────────────────────

  it("exits 2 for unknown flags (parseArgs strict mode)", async () => {
    const result = await runCli(["--unknown-flag"]);

    expect(result.exitCalls[0]).toBe(2);
  });

  // ── apcore-js availability ─────────────────────────────────────────────

  it("fails when apcore-js is not installed", async () => {
    // apcore-js is not in node_modules, so the dynamic import naturally fails
    const result = await runCli(["--extensions-dir", tmpDir]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) => m.includes("apcore-js")),
    ).toBe(true);
  });

  // ── Success path with mocked apcore-js ─────────────────────────────────

  it("succeeds when apcore-js is available and calls serve()", async () => {
    const MockRegistry = vi.fn().mockImplementation(() => ({
      discover: vi.fn().mockReturnValue(3),
    }));
    vi.doMock("apcore-js", () => ({
      Registry: MockRegistry,
    }));

    const mockServe = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../src/index.js", () => ({
      serve: mockServe,
      VERSION: "0.0.0-test",
    }));

    process.argv = ["node", "cli.js", "--extensions-dir", tmpDir];

    try {
      await import("../src/cli.js");
    } catch {
      // Swallow
    }
    await new Promise((r) => setTimeout(r, 200));

    expect(MockRegistry).toHaveBeenCalledTimes(1);
    expect(mockServe).toHaveBeenCalledTimes(1);
    // No process.exit was called — clean exit
    expect(exitCalls).toHaveLength(0);
  });

  it("warns when 0 modules are discovered", async () => {
    const MockRegistry = vi.fn().mockImplementation(() => ({
      discover: vi.fn().mockReturnValue(0),
    }));
    vi.doMock("apcore-js", () => ({
      Registry: MockRegistry,
    }));

    const mockServe = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../src/index.js", () => ({
      serve: mockServe,
      VERSION: "0.0.0-test",
    }));

    process.argv = ["node", "cli.js", "--extensions-dir", tmpDir];

    try {
      await import("../src/cli.js");
    } catch {
      // Swallow
    }
    await new Promise((r) => setTimeout(r, 200));

    expect(
      warnMessages.some((m) => m.includes("No modules discovered")),
    ).toBe(true);
    expect(mockServe).toHaveBeenCalledTimes(1);
  });

  it("logs module count when modules are discovered", async () => {
    const MockRegistry = vi.fn().mockImplementation(() => ({
      discover: vi.fn().mockReturnValue(5),
    }));
    vi.doMock("apcore-js", () => ({
      Registry: MockRegistry,
    }));

    const mockServe = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../src/index.js", () => ({
      serve: mockServe,
      VERSION: "0.0.0-test",
    }));

    process.argv = ["node", "cli.js", "--extensions-dir", tmpDir];

    try {
      await import("../src/cli.js");
    } catch {
      // Swallow
    }
    await new Promise((r) => setTimeout(r, 200));

    expect(
      infoMessages.some((m) => m.includes("Discovered 5 module(s)")),
    ).toBe(true);
  });

  it("fails for invalid --log-level", async () => {
    const MockRegistry = vi.fn().mockImplementation(() => ({
      discover: vi.fn().mockReturnValue(1),
    }));
    vi.doMock("apcore-js", () => ({
      Registry: MockRegistry,
    }));

    const result = await runCli([
      "--extensions-dir",
      tmpDir,
      "--log-level",
      "TRACE",
    ]);

    expect(result.exitCalls[0]).toBe(1);
    expect(
      result.errorMessages.some((m) =>
        m.includes("--log-level must be one of"),
      ),
    ).toBe(true);
  });
});
