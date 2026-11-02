import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { format } from "node:util";
import * as apcore from "apcore-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { ExecutionRouter } from "../../src/server/router.js";
import { MCPServerFactory } from "../../src/server/factory.js";
import { ApprovalBridge } from "../../src/server/approval-bridge.js";
import { AsyncTaskBridge, META_TOOL_NAMES } from "../../src/server/async-task-bridge.js";
import type { AsyncTaskManagerLike } from "../../src/server/async-task-bridge.js";
import type { Executor } from "../../src/types.js";

const secret = "SYNTHETIC_OUTPUT_SECRET";
const executor = (value: Record<string, unknown>): Executor => ({ registry: {} as Executor["registry"], call: async () => value });
afterEach(() => vi.restoreAllMocks());

describe("tool errors on the MCP wire", () => {
  it.each(["INVALID_INPUT", "MODULE_NOT_FOUND"])("preserves %s from a known tool while rejecting unknown tools as protocol errors", async code => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const factory = new MCPServerFactory({ richDescription: false });
    const server = factory.createServer();
    const call = vi.fn(async () => { throw new apcore.ModuleError(code, "Controlled tool failure"); });
    const router = new ExecutionRouter({ ...executor({}), call });
    const approval = new ApprovalBridge({ checkApproval: async () => ({ status: "pending" }) });
    factory.registerHandlers(server, [{ name: "demo", inputSchema: { type: "object" } }], router, { approvalBridge: approval });
    const client = new Client({ name: "output-safety", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);
      const result = await client.callTool({ name: "demo", arguments: {} });
      expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("Controlled tool failure") }] });
      expect(call).toHaveBeenCalledOnce();
      await expect(client.callTool({ name: "missing.tool", arguments: {} })).rejects.toMatchObject({ code: -32602 });
      expect(call).toHaveBeenCalledOnce();
      const denied = await client.callTool({ name: "__apcore_approval_check", arguments: {} });
      expect(denied).toMatchObject({ isError: true, content: [{ text: "approval_id is required" }] });
      await expect(client.request({ method: "unsupported" } as never, CallToolResultSchema)).rejects.toMatchObject({ code: -32601 });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("output redaction safety", () => {
  it.each([undefined, {}])("applies default key rules without a declared schema: %j", async schema => {
    const value = { password: secret, visible: "public" };
    const router = new ExecutionRouter(executor(value), schema ? { outputSchemaMap: { demo: schema } } : {});
    const [content, isError] = await router.handleCall("demo", {});
    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text)).toEqual({ password: "***REDACTED***", visible: "public" });
    expect(value.password).toBe(secret);
  });

  it("returns a safe tool error and no sensitive logs when redaction throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = new Proxy({}, { get() { throw new Error(secret); } });
    const [content, isError] = await new ExecutionRouter(executor({ password: secret }), { outputSchemaMap: { demo: schema } }).handleCall("demo", {});
    expect(isError).toBe(true);
    expect(content[0].text).toBe("Internal error occurred");
    expect(format(errorLog.mock.calls, warnLog.mock.calls)).not.toContain(secret);
  });

  it("does not send a progress chunk when redaction fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sendNotification = vi.fn();
    const schema = new Proxy({}, { get() { throw new Error(secret); } });
    const streaming = { ...executor({}), stream: async function* () { yield { password: secret }; } };
    const [, isError] = await new ExecutionRouter(streaming, { outputSchemaMap: { demo: schema } }).handleCall("demo", {}, { _meta: { progressToken: "progress" }, sendNotification });
    expect(isError).toBe(true);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("honors explicitly disabled redaction", async () => {
    const [content, isError] = await new ExecutionRouter(executor({ password: secret }), { redactOutput: false }).handleCall("demo", {});
    expect(isError).toBe(false);
    expect(JSON.parse(content[0].text).password).toBe(secret);
  });

  it("allows the existing formatter to hash the redacted representation", async () => {
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const data = { sessionId: secret, value: 1 };
    const [content, isError] = await new ExecutionRouter(executor({ data, digest: hash(data) }), {
      outputSchemaMap: { demo: {} },
      outputFormatter: result => JSON.stringify({ ...result, digest: hash((result as Record<string, unknown>).data) }),
    }).handleCall("demo", {});
    const output = JSON.parse(content[0].text);
    expect(isError).toBe(false);
    expect(output.data.sessionId).toBe("***REDACTED***");
    expect(output.digest).toBe(hash(output.data));
  });

  it("does not log error messages, causes, stacks or custom fields", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error(secret, { cause: new Error(secret) }), { details: { password: secret }, code: secret });
    const [, isError] = await new ExecutionRouter({ ...executor({}), call: async () => { throw failure; } }).handleCall("demo", {});
    expect(isError).toBe(true);
    expect(log).toHaveBeenCalled();
    expect(format(...log.mock.calls.flat())).not.toContain(secret);
  });

  it("fails closed when the SDK redactor is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("apcore-js", async importOriginal => ({ ...await importOriginal<typeof apcore>(), default: undefined, redactSensitive: undefined }));
    try {
      const { ExecutionRouter: Router } = await import("../../src/server/router.js");
      const [content, isError] = await new Router(executor({ password: secret }), { outputSchemaMap: { demo: {} } }).handleCall("demo", {});
      expect(isError).toBe(true);
      expect(JSON.stringify(content)).not.toContain(secret);
    } finally {
      vi.doUnmock("apcore-js");
      vi.resetModules();
    }
  });
});

describe("async result redaction", () => {
  const manager = () => ({ getStatus: () => ({ taskId: "t1", moduleId: "demo", status: "completed", submittedAt: 0, startedAt: 0, completedAt: 1, result: { password: secret }, error: null }) }) as unknown as AsyncTaskManagerLike;

  it("passes an empty schema to a configured redactor when no schema is declared", async () => {
    const redact = vi.fn(apcore.redactSensitive);
    const bridge = new AsyncTaskBridge(manager(), { redactSensitive: redact });
    const result = await bridge.handleMetaTool(META_TOOL_NAMES.STATUS, { task_id: "t1" });
    expect(redact).toHaveBeenCalledWith({ password: secret }, {});
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("withholds the result and exception details when a configured redactor fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = new AsyncTaskBridge(manager(), { redactSensitive: () => { throw new Error(secret); }, outputSchemaMap: { demo: {} } });
    await expect(bridge.handleMetaTool(META_TOOL_NAMES.STATUS, { task_id: "t1" })).rejects.toThrow("Output redaction failed");
    expect(format(warn.mock.calls)).not.toContain(secret);
    const [content, isError] = await new ExecutionRouter(executor({}), { asyncTaskBridge: bridge }).handleCall(META_TOOL_NAMES.STATUS, { task_id: "t1" });
    expect(isError).toBe(true);
    expect(content[0].text).toBe("Internal error occurred");
    expect(JSON.stringify(content)).not.toContain(secret);
  });
});
