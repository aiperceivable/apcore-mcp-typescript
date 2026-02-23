/**
 * Tests for the CLI entry point (src/cli.ts).
 *
 * We call the exported `main()` function directly with mocked process.argv.
 * process.exit is mocked to throw a sentinel so that fail()/exit() stops
 * execution cleanly rather than continuing past the mock.
 *
 * IMPORTANT: apcore-js on npm is a stub without dist/. All test scenarios
 * must vi.doMock("apcore-js") BEFORE importing cli.ts to avoid Vite
 * resolution errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Sentinel for process.exit ──────────────────────────────────────────────

class ExitSentinel extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

describe("CLI (cli.ts)", () => {
  const originalArgv = [...process.argv];
  const originalExit = process.exit;

  let tmpDir: string;
  let errorMessages: string[];
  let logMessages: string[];
  let infoMessages: string[];
  let warnMessages: string[];

  // Suppress unhandled rejections from module-level main().catch() auto-invocation
  const suppressUnhandled = (err: unknown) => {
    if (err instanceof ExitSentinel) return; // expected
  };

  beforeEach(() => {
    vi.resetModules();
    process.on("unhandledRejection", suppressUnhandled);

    errorMessages = [];
    logMessages = [];
    infoMessages = [];
    warnMessages = [];

    tmpDir = mkdtempSync(join(tmpdir(), "apcore-cli-test-"));

    // Mock process.exit to throw sentinel — stops further execution
    process.exit = ((code?: number) => {
      throw new ExitSentinel(code ?? 0);
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
    process.removeListener("unhandledRejection", suppressUnhandled);
    vi.restoreAllMocks();
    try {
      rmdirSync(tmpDir);
    } catch {
      // ignore cleanup errors
    }
  });

  /**
   * Set process.argv, mock all external deps, and call main() directly.
   * Returns the exit code from ExitSentinel, or -1 if main() completed normally.
   *
   * Every scenario mocks apcore-js (either as available or unavailable)
   * to avoid Vite trying to resolve the stub package.
   */
  async function runMain(args: string[], opts: {
    apcoreAvailable?: boolean;
    discoverCount?: number;
    serveFn?: ReturnType<typeof vi.fn>;
  } = {}) {
    const { apcoreAvailable = true, discoverCount = 0, serveFn } = opts;

    process.argv = ["node", "cli.js", ...args];

    // Always mock apcore-js to prevent Vite resolution errors
    if (apcoreAvailable) {
      vi.doMock("apcore-js", () => ({
        Registry: vi.fn().mockImplementation(() => ({
          discover: vi.fn().mockResolvedValue(discoverCount),
        })),
      }));
    } else {
      vi.doMock("apcore-js", () => {
        throw new Error("Cannot find module 'apcore-js'");
      });
    }

    // Always mock index.js for serve/VERSION
    const mockServe = serveFn ?? vi.fn().mockResolvedValue(undefined);
    vi.doMock("../src/index.js", () => ({
      serve: mockServe,
      VERSION: "0.0.0-test",
    }));

    const mod = await import("../src/cli.js");

    // Wait a tick for the module-level main().catch() auto-invocation to settle
    await new Promise((r) => setTimeout(r, 50));

    const { main } = mod;

    try {
      await main();
      return { exitCode: -1, mockServe };
    } catch (e) {
      if (e instanceof ExitSentinel) {
        return { exitCode: e.code, mockServe };
      }
      throw e;
    }
  }

  // ── Help ────────────────────────────────────────────────────────────────

  it("prints help and exits 0 with --help", async () => {
    const { exitCode } = await runMain(["--help"]);

    expect(exitCode).toBe(0);
    expect(logMessages.some((m) => m.includes("apcore-mcp"))).toBe(true);
    expect(logMessages.some((m) => m.includes("--extensions-dir"))).toBe(true);
  });

  // ── Argument validation ────────────────────────────────────────────────

  it("fails when --extensions-dir is missing", async () => {
    const { exitCode } = await runMain([]);

    expect(exitCode).toBe(1);
    expect(
      errorMessages.some((m) => m.includes("--extensions-dir is required")),
    ).toBe(true);
  });

  it("fails when --extensions-dir path does not exist", async () => {
    const { exitCode } = await runMain([
      "--extensions-dir",
      "/nonexistent/path/12345",
    ]);

    expect(exitCode).toBe(1);
    expect(errorMessages.some((m) => m.includes("does not exist"))).toBe(true);
  });

  it("fails for invalid --transport", async () => {
    const { exitCode } = await runMain([
      "--extensions-dir", tmpDir,
      "--transport", "websocket",
    ]);

    expect(exitCode).toBe(1);
    expect(
      errorMessages.some((m) => m.includes("--transport must be one of")),
    ).toBe(true);
  });

  it("fails for out-of-range --port", async () => {
    const { exitCode } = await runMain([
      "--extensions-dir", tmpDir,
      "--port", "99999",
    ]);

    expect(exitCode).toBe(1);
    expect(
      errorMessages.some((m) => m.includes("--port must be in range")),
    ).toBe(true);
  });

  it("fails for non-numeric --port", async () => {
    const { exitCode } = await runMain([
      "--extensions-dir", tmpDir,
      "--port", "abc",
    ]);

    expect(exitCode).toBe(1);
    expect(
      errorMessages.some((m) => m.includes("--port must be in range")),
    ).toBe(true);
  });

  it("fails for --name exceeding 255 characters", async () => {
    const longName = "a".repeat(256);
    const { exitCode } = await runMain([
      "--extensions-dir", tmpDir,
      "--name", longName,
    ]);

    expect(exitCode).toBe(1);
    expect(
      errorMessages.some((m) => m.includes("--name must be at most 255")),
    ).toBe(true);
  });

  // ── Unknown flags ──────────────────────────────────────────────────────

  it("exits 2 for unknown flags (parseArgs strict mode)", async () => {
    const { exitCode } = await runMain(["--unknown-flag"]);

    expect(exitCode).toBe(2);
  });

  // ── apcore-js availability ─────────────────────────────────────────────

  it("fails when apcore-js is not importable", async () => {
    const { exitCode } = await runMain(
      ["--extensions-dir", tmpDir],
      { apcoreAvailable: false },
    );

    expect(exitCode).toBe(1);
    expect(errorMessages.some((m) => m.includes("apcore-js"))).toBe(true);
  });

  // ── Success path ───────────────────────────────────────────────────────

  it("succeeds when apcore-js is available and calls serve()", async () => {
    const { exitCode, mockServe } = await runMain(
      ["--extensions-dir", tmpDir],
      { apcoreAvailable: true, discoverCount: 3 },
    );

    expect(exitCode).toBe(-1); // no process.exit
    // main() is called manually + once by module-level auto-invocation
    expect(mockServe).toHaveBeenCalled();
  });

  it("warns when 0 modules are discovered", async () => {
    const { exitCode, mockServe } = await runMain(
      ["--extensions-dir", tmpDir],
      { apcoreAvailable: true, discoverCount: 0 },
    );

    expect(exitCode).toBe(-1);
    expect(
      warnMessages.some((m) => m.includes("No modules discovered")),
    ).toBe(true);
    expect(mockServe).toHaveBeenCalled();
  });

  it("logs module count when modules are discovered", async () => {
    const { exitCode } = await runMain(
      ["--extensions-dir", tmpDir],
      { apcoreAvailable: true, discoverCount: 5 },
    );

    expect(exitCode).toBe(-1);
    expect(
      infoMessages.some((m) => m.includes("Discovered 5 module(s)")),
    ).toBe(true);
  });

  it("fails for invalid --log-level", async () => {
    const { exitCode } = await runMain(
      ["--extensions-dir", tmpDir, "--log-level", "TRACE"],
      { apcoreAvailable: true, discoverCount: 1 },
    );

    expect(exitCode).toBe(1);
    expect(
      errorMessages.some((m) => m.includes("--log-level must be one of")),
    ).toBe(true);
  });
});
