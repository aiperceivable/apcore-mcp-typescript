import { describe, it, expect, vi } from "vitest";
import { ApprovalBridge, APPROVAL_META_TOOL_NAMES } from "../../src/server/approval-bridge.js";

function buildHandler(overrides: Partial<{
  checkApproval: (id: string) => Promise<{ status: string; reason?: string; approvalId?: string }>;
}> = {}) {
  return {
    checkApproval: overrides.checkApproval ?? vi.fn().mockResolvedValue({ status: "pending", approvalId: "abc" }),
  };
}

describe("ApprovalBridge", () => {
  describe("isMetaTool", () => {
    it("returns true for __apcore_approval_check", () => {
      expect(ApprovalBridge.isMetaTool("__apcore_approval_check")).toBe(true);
    });

    it("returns false for async task meta-tools", () => {
      expect(ApprovalBridge.isMetaTool("__apcore_task_submit")).toBe(false);
      expect(ApprovalBridge.isMetaTool("__apcore_task_status")).toBe(false);
    });

    it("returns false for regular tool names", () => {
      expect(ApprovalBridge.isMetaTool("my.module")).toBe(false);
      expect(ApprovalBridge.isMetaTool("")).toBe(false);
    });
  });

  describe("APPROVAL_META_TOOL_NAMES constant", () => {
    it("contains __apcore_approval_check", () => {
      expect(APPROVAL_META_TOOL_NAMES).toContain("__apcore_approval_check");
    });
  });

  describe("buildMetaTools", () => {
    it("returns one tool with correct name", () => {
      const bridge = new ApprovalBridge(buildHandler());
      const tools = bridge.buildMetaTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("__apcore_approval_check");
    });

    it("tool has correct input schema requiring approval_id", () => {
      const bridge = new ApprovalBridge(buildHandler());
      const [tool] = bridge.buildMetaTools();
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema.required).toContain("approval_id");
      expect(schema.additionalProperties).toBe(false);
    });

    it("tool description mentions approval_id and status values", () => {
      const bridge = new ApprovalBridge(buildHandler());
      const [tool] = bridge.buildMetaTools();
      expect(tool.description).toContain("approval_id");
      expect(tool.description).toContain("pending");
      expect(tool.description).toContain("approved");
      expect(tool.description).toContain("rejected");
    });
  });

  describe("handleMetaTool - __apcore_approval_check", () => {
    it("passes through pending status", async () => {
      const handler = buildHandler({
        checkApproval: vi.fn().mockResolvedValue({ status: "pending", approvalId: "abc" }),
      });
      const bridge = new ApprovalBridge(handler);
      const [content, isError, traceId] = await bridge.handleMetaTool("__apcore_approval_check", {
        approval_id: "abc",
      });
      expect(isError).toBe(false);
      expect(traceId).toBeNull();
      const payload = JSON.parse(content[0].text);
      expect(payload.approval_id).toBe("abc");
      expect(payload.status).toBe("pending");
    });

    it("passes through approved status without reason", async () => {
      const handler = buildHandler({
        checkApproval: vi.fn().mockResolvedValue({ status: "approved" }),
      });
      const bridge = new ApprovalBridge(handler);
      const [content, isError] = await bridge.handleMetaTool("__apcore_approval_check", {
        approval_id: "my-id",
      });
      expect(isError).toBe(false);
      const payload = JSON.parse(content[0].text);
      expect(payload.status).toBe("approved");
      expect("reason" in payload).toBe(false);
    });

    it("passes through rejected status with reason", async () => {
      const handler = buildHandler({
        checkApproval: vi.fn().mockResolvedValue({ status: "rejected", reason: "no budget" }),
      });
      const bridge = new ApprovalBridge(handler);
      const [content, isError] = await bridge.handleMetaTool("__apcore_approval_check", {
        approval_id: "my-id",
      });
      expect(isError).toBe(false);
      const payload = JSON.parse(content[0].text);
      expect(payload.status).toBe("rejected");
      expect(payload.reason).toBe("no budget");
    });

    it("missing approval_id returns is_error=true", async () => {
      const bridge = new ApprovalBridge(buildHandler());
      const [content, isError] = await bridge.handleMetaTool("__apcore_approval_check", {});
      expect(isError).toBe(true);
      expect(content[0].text).toContain("approval_id");
    });

    it("empty string approval_id returns is_error=true", async () => {
      const bridge = new ApprovalBridge(buildHandler());
      const [content, isError] = await bridge.handleMetaTool("__apcore_approval_check", {
        approval_id: "",
      });
      expect(isError).toBe(true);
    });

    it("checkApproval throwing returns is_error=true", async () => {
      const handler = buildHandler({
        checkApproval: vi.fn().mockRejectedValue(new Error("store down")),
      });
      const bridge = new ApprovalBridge(handler);
      const [content, isError] = await bridge.handleMetaTool("__apcore_approval_check", {
        approval_id: "abc",
      });
      expect(isError).toBe(true);
      expect(content[0].text).toContain("store down");
    });
  });

  describe("handleMetaTool - unknown tool name", () => {
    it("returns is_error=true for unknown meta-tool", async () => {
      const bridge = new ApprovalBridge(buildHandler());
      const [content, isError] = await bridge.handleMetaTool("__apcore_unknown_tool", {});
      expect(isError).toBe(true);
      expect(content[0].text).toContain("Unknown approval meta-tool");
    });
  });
});
