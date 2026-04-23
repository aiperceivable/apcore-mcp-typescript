import { describe, it, expect, vi } from "vitest";
import { parseTraceparent, buildTraceparent } from "../../src/server/traceContext.js";
import { ExecutionRouter } from "../../src/server/router.js";
import { MCPServerFactory } from "../../src/server/factory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Executor, Registry } from "../../src/types.js";

describe("parseTraceparent", () => {
  it("accepts a valid 00-<32hex>-<16hex>-<2hex> header", async () => {
    const raw = "00-11112222333344445555666677778888-aabbccddeeff0011-01";
    const parsed = await parseTraceparent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.traceId).toBe("11112222333344445555666677778888");
    expect(parsed!.parentId).toBe("aabbccddeeff0011");
  });

  it("rejects malformed header", async () => {
    expect(await parseTraceparent("not-a-real-header")).toBeNull();
  });

  it("rejects version=ff", async () => {
    const raw = "ff-11112222333344445555666677778888-aabbccddeeff0011-01";
    expect(await parseTraceparent(raw)).toBeNull();
  });

  it("rejects all-zero trace_id", async () => {
    const raw = "00-00000000000000000000000000000000-aabbccddeeff0011-01";
    expect(await parseTraceparent(raw)).toBeNull();
  });

  it("rejects empty string", async () => {
    expect(await parseTraceparent("")).toBeNull();
  });
});

describe("buildTraceparent", () => {
  it("emits a valid W3C traceparent string", () => {
    const traceId = "11112222333344445555666677778888";
    const tp = buildTraceparent(traceId);
    expect(tp).toMatch(/^00-11112222333344445555666677778888-[0-9a-f]{16}-01$/);
  });

  it("generates a distinct parent id each call", () => {
    const id = "aabbccddeeff00112233445566778899";
    const a = buildTraceparent(id);
    const b = buildTraceparent(id);
    expect(a).not.toBe(b);
  });
});

describe("ExecutionRouter + traceparent propagation", () => {
  function createMockExecutor(result: Record<string, unknown>): Executor {
    return {
      registry: {
        getDefinition: () => null,
      } as unknown as Registry,
      call: vi.fn().mockResolvedValue(result),
    };
  }

  it("inbound _meta.traceparent overrides generated traceId", async () => {
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    const incomingTraceId = "aabbccddeeff00112233445566778899";
    const [, , traceId] = await router.handleCall(
      "demo.module",
      {},
      {
        _meta: {
          traceparent: `00-${incomingTraceId}-0011223344556677-01`,
        },
      },
    );

    expect(traceId).toBe(incomingTraceId);
  });

  it("invalid traceparent falls back to fresh traceId", async () => {
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    const [, , traceId] = await router.handleCall(
      "demo.module",
      {},
      { _meta: { traceparent: "garbage" } },
    );

    // No context created → traceId is undefined (no callbacks, no identity,
    // no valid inbound traceparent).
    expect(traceId).toBeUndefined();
  });
});

describe("MCPServerFactory tools/call — traceparent round-trip", () => {
  it("attaches `_meta.traceparent` on successful tool responses", async () => {
    const factory = new MCPServerFactory();
    const server = factory.createServer("test", "0.0.0");

    const executor: Executor = {
      registry: { getDefinition: () => null } as unknown as Registry,
      call: vi.fn().mockResolvedValue({ ok: true }),
    };
    const router = new ExecutionRouter(executor);

    const handlers = new Map<string, (req: any, extra?: any) => Promise<unknown>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as unknown as { setRequestHandler: (schema: any, h: any) => void }).setRequestHandler =
      (schema: { shape: { method: { value: string } } }, handler: any) => {
        handlers.set(schema.shape.method.value, handler);
      };

    factory.registerHandlers(server, [], router);

    const callHandler = handlers.get(CallToolRequestSchema.shape.method.value)!;
    const incomingTraceId = "11112222333344445555666677778888";
    const result = (await callHandler(
      {
        params: {
          name: "demo.module",
          arguments: {},
          _meta: { traceparent: `00-${incomingTraceId}-0011223344556677-01` },
        },
      },
      {},
    )) as { content: unknown[]; _meta?: { traceparent?: string } };

    expect(result._meta?.traceparent).toBeDefined();
    expect(result._meta?.traceparent).toMatch(
      new RegExp(`^00-${incomingTraceId}-[0-9a-f]{16}-01$`),
    );
    // Silence lint for unused import
    expect(ListToolsRequestSchema).toBeDefined();
  });
});
