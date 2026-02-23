/**
 * Tests for /metrics Prometheus endpoint in TransportManager.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { TransportManager } from "../../src/server/transport.js";
import type { MetricsExporter } from "../../src/server/transport.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AddressInfo } from "node:net";

const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function makeCollector(exportText: string = ""): MetricsExporter {
  return { exportPrometheus: vi.fn().mockReturnValue(exportText) };
}

function makeMockServer(): Server {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as Server;
}

describe("metrics endpoint (streamable-http)", () => {
  let mgr: TransportManager;

  afterEach(async () => {
    if (mgr) await mgr.close();
  });

  it("returns 404 when no metrics collector is set", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runStreamableHttp(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with Prometheus text when collector is set", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    const promText = "# HELP c desc\n# TYPE c counter\nc 1\n";
    const collector = makeCollector(promText);
    mgr.setMetricsCollector(collector);

    await mgr.runStreamableHttp(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(promText);
  });

  it("returns correct Content-Type header", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    mgr.setMetricsCollector(makeCollector("data\n"));

    await mgr.runStreamableHttp(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.headers.get("content-type")).toBe(PROMETHEUS_CONTENT_TYPE);
  });

  it("calls exportPrometheus() on the collector", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    const collector = makeCollector("data\n");
    mgr.setMetricsCollector(collector);

    await mgr.runStreamableHttp(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(collector.exportPrometheus).toHaveBeenCalledOnce();
  });

  it("returns empty body when collector exports empty string", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    mgr.setMetricsCollector(makeCollector(""));

    await mgr.runStreamableHttp(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("returns 500 when exportPrometheus() throws", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    const collector: MetricsExporter = {
      exportPrometheus: vi.fn().mockImplementation(() => {
        throw new Error("collector broke");
      }),
    };
    mgr.setMetricsCollector(collector);

    await mgr.runStreamableHttp(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(500);
  });
});

describe("metrics endpoint (sse)", () => {
  let mgr: TransportManager;

  afterEach(async () => {
    if (mgr) await mgr.close();
  });

  it("returns 404 when no metrics collector is set", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});

    await mgr.runSse(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with Prometheus text when collector is set", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    const promText = "# HELP m desc\n# TYPE m counter\nm 42\n";
    const collector = makeCollector(promText);
    mgr.setMetricsCollector(collector);

    await mgr.runSse(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(promText);
  });

  it("returns correct Content-Type header", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    mgr.setMetricsCollector(makeCollector("data\n"));

    await mgr.runSse(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.headers.get("content-type")).toBe(PROMETHEUS_CONTENT_TYPE);
  });

  it("returns 500 when exportPrometheus() throws", async () => {
    mgr = new TransportManager();
    vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
    const collector: MetricsExporter = {
      exportPrometheus: vi.fn().mockImplementation(() => {
        throw new Error("collector broke");
      }),
    };
    mgr.setMetricsCollector(collector);

    await mgr.runSse(makeMockServer(), {
      host: "127.0.0.1",
      port: 0,
    });

    const addr = mgr.httpServer!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/metrics`);
    expect(res.status).toBe(500);
  });
});

describe("setMetricsCollector", () => {
  it("stores the collector for later use", () => {
    const mgr = new TransportManager();
    const collector = makeCollector("test\n");
    // Should not throw
    mgr.setMetricsCollector(collector);
  });
});
