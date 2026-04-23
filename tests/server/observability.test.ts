import { describe, it, expect, vi } from "vitest";
import { installObservability } from "../../src/server/observability.js";
import { TransportManager } from "../../src/server/transport.js";
import type { MetricsExporter } from "../../src/server/transport.js";

describe("installObservability", () => {
  it("returns an empty stack when flags are off", async () => {
    const executor = { use: vi.fn() };
    const stack = await installObservability(executor, undefined, undefined);
    expect(stack.metricsCollector).toBeUndefined();
    expect(stack.usageCollector).toBeUndefined();
    expect(stack.middleware).toEqual([]);
    expect(executor.use).not.toHaveBeenCalled();
  });

  it("passes through a pre-instantiated MetricsExporter without re-wiring", async () => {
    const exporter: MetricsExporter = {
      exportPrometheus: () => "# test\n",
    };
    const executor = { use: vi.fn() };
    const stack = await installObservability(executor, exporter, undefined);
    expect(stack.metricsCollector).toBe(exporter);
    expect(stack.middleware).toEqual([]);
    expect(executor.use).not.toHaveBeenCalled();
  });

  it("auto-wires MetricsMiddleware when metricsCollector=true", async () => {
    const executor = { use: vi.fn() };
    const stack = await installObservability(executor, true, undefined);
    expect(stack.metricsCollector).toBeDefined();
    expect(typeof stack.metricsCollector?.exportPrometheus).toBe("function");
    // MetricsMiddleware should have been installed.
    expect(executor.use).toHaveBeenCalledTimes(1);
  });

  it("observability=true installs both MetricsMiddleware + UsageMiddleware", async () => {
    const executor = { use: vi.fn() };
    const stack = await installObservability(executor, undefined, true);
    expect(stack.metricsCollector).toBeDefined();
    expect(stack.usageCollector).toBeDefined();
    expect(executor.use).toHaveBeenCalledTimes(2);
  });

  it("fine-grained object form toggles individual middleware", async () => {
    const executor = { use: vi.fn() };
    const stack = await installObservability(executor, undefined, {
      metrics: true,
      usage: false,
    });
    expect(stack.metricsCollector).toBeDefined();
    expect(stack.usageCollector).toBeUndefined();
    expect(executor.use).toHaveBeenCalledTimes(1);
  });

  it("warns when executor lacks .use() but still returns collectors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const executor = {}; // no .use()
    const stack = await installObservability(executor, undefined, true);
    expect(stack.metricsCollector).toBeDefined();
    expect(stack.usageCollector).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("TransportManager /usage route", () => {
  it("returns 404 when no usage collector is wired", async () => {
    const tm = new TransportManager();
    const req = { method: "GET", url: "/usage" } as unknown as import("node:http").IncomingMessage;
    const headers: Array<[number, Record<string, string> | undefined]> = [];
    let ended = false;
    const res = {
      writeHead(code: number, h?: Record<string, string>) {
        headers.push([code, h]);
        return this;
      },
      end() {
        ended = true;
      },
    } as unknown as import("node:http").ServerResponse;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handled = (tm as any)._handleBuiltinRoute(req, res, new URL("http://x/usage"));
    expect(handled).toBe(true);
    expect(headers[0][0]).toBe(404);
    expect(ended).toBe(true);
  });

  it("serves JSON summary when usage collector is wired", async () => {
    const tm = new TransportManager();
    const usage = {
      getSummary: vi.fn().mockReturnValue([
        { moduleId: "demo.module", callCount: 3, errorCount: 0 },
      ]),
      getModule: vi.fn(),
    };
    tm.setUsageCollector(usage);

    const chunks: string[] = [];
    const req = { method: "GET", url: "/usage" } as unknown as import("node:http").IncomingMessage;
    let statusCode = 0;
    const res = {
      writeHead(code: number) {
        statusCode = code;
        return this;
      },
      end(body: string) {
        chunks.push(body);
      },
    } as unknown as import("node:http").ServerResponse;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handled = (tm as any)._handleBuiltinRoute(req, res, new URL("http://x/usage?period=1h"));
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    const payload = JSON.parse(chunks[0]);
    expect(payload.summary).toEqual([
      { moduleId: "demo.module", callCount: 3, errorCount: 0 },
    ]);
    expect(payload.period).toBe("1h");
    expect(usage.getSummary).toHaveBeenCalledWith("1h");
  });

  it("serves per-module detail when module_id query param is set", async () => {
    const tm = new TransportManager();
    const usage = {
      getSummary: vi.fn(),
      getModule: vi.fn().mockReturnValue({ moduleId: "demo", callCount: 5 }),
    };
    tm.setUsageCollector(usage);

    const chunks: string[] = [];
    const req = { method: "GET" } as unknown as import("node:http").IncomingMessage;
    const res = {
      writeHead() {
        return this;
      },
      end(body: string) {
        chunks.push(body);
      },
    } as unknown as import("node:http").ServerResponse;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tm as any)._handleBuiltinRoute(
      req,
      res,
      new URL("http://x/usage?module_id=demo&period=7d"),
    );
    expect(usage.getModule).toHaveBeenCalledWith("demo", "7d");
    expect(JSON.parse(chunks[0])).toEqual({ moduleId: "demo", callCount: 5 });
  });
});
