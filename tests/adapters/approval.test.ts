import { describe, it, expect, vi } from "vitest";
import { ElicitationApprovalHandler } from "../../src/adapters/approval.js";
import { MCP_ELICIT_KEY } from "../../src/helpers.js";

describe("ElicitationApprovalHandler", () => {
  const handler = new ElicitationApprovalHandler();

  it("returns rejected when context is null", async () => {
    const result = await handler.requestApproval({
      moduleId: "test.module",
      arguments: {},
      context: null,
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("No context");
  });

  it("returns rejected when context.data is missing", async () => {
    const result = await handler.requestApproval({
      moduleId: "test.module",
      arguments: {},
      context: {},
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("No context");
  });

  it("returns rejected when elicit callback is absent", async () => {
    const result = await handler.requestApproval({
      moduleId: "test.module",
      arguments: {},
      context: { data: {} },
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("No elicitation callback");
  });

  it("returns approved when elicit callback returns accept", async () => {
    const elicitFn = vi.fn().mockResolvedValue({ action: "accept" });
    const result = await handler.requestApproval({
      moduleId: "test.module",
      description: "Run the test",
      arguments: { key: "value" },
      context: { data: { [MCP_ELICIT_KEY]: elicitFn } },
    });

    expect(result.status).toBe("approved");
    expect(elicitFn).toHaveBeenCalledTimes(1);
    const message = elicitFn.mock.calls[0][0] as string;
    expect(message).toContain("test.module");
    expect(message).toContain("Run the test");
    expect(message).toContain("key");
  });

  it("returns rejected when elicit callback returns decline", async () => {
    const elicitFn = vi.fn().mockResolvedValue({ action: "decline" });
    const result = await handler.requestApproval({
      moduleId: "test.module",
      arguments: {},
      context: { data: { [MCP_ELICIT_KEY]: elicitFn } },
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("decline");
  });

  it("returns rejected when elicit callback returns cancel", async () => {
    const elicitFn = vi.fn().mockResolvedValue({ action: "cancel" });
    const result = await handler.requestApproval({
      moduleId: "test.module",
      arguments: {},
      context: { data: { [MCP_ELICIT_KEY]: elicitFn } },
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("cancel");
  });

  it("returns rejected when elicit callback returns null", async () => {
    const elicitFn = vi.fn().mockResolvedValue(null);
    const result = await handler.requestApproval({
      moduleId: "test.module",
      arguments: {},
      context: { data: { [MCP_ELICIT_KEY]: elicitFn } },
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("no response");
  });

  it("returns rejected when elicit callback throws", async () => {
    const elicitFn = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await handler.requestApproval({
      moduleId: "test.module",
      arguments: {},
      context: { data: { [MCP_ELICIT_KEY]: elicitFn } },
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("failed");
  });

  it("checkApproval always returns rejected (Phase B not supported)", async () => {
    const result = await handler.checkApproval("some-id");

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("Phase B");
  });
});
