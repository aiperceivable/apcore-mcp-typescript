/**
 * ApprovalBridge: exposes __apcore_approval_check as an MCP meta-tool.
 *
 * Symmetric with AsyncTaskBridge. Registered in MCPServerFactory.registerHandlers()
 * alongside asyncBridge.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const APPROVAL_META_TOOL_NAMES = ["__apcore_approval_check"] as const;

export type ApprovalMetaToolName = (typeof APPROVAL_META_TOOL_NAMES)[number];

export class ApprovalBridge {
  // handler is StorageBackedApprovalHandler but typed loosely for cross-SDK compat
  constructor(private readonly handler: {
    checkApproval(approvalId: string): Promise<{ status: string; reason?: string; approvalId?: string }>;
  }) {}

  static isMetaTool(name: string): name is ApprovalMetaToolName {
    return (APPROVAL_META_TOOL_NAMES as readonly string[]).includes(name);
  }

  buildMetaTools(): Tool[] {
    return [
      {
        name: "__apcore_approval_check",
        description:
          "Poll the status of a pending approval request. " +
          "Returns {approval_id, status, reason}. " +
          "status is 'pending', 'approved', or 'rejected'. " +
          "When 'approved', retry the original tool call with " +
          "_meta.approvalId set to this approval_id.",
        inputSchema: {
          type: "object" as const,
          properties: {
            approval_id: {
              type: "string",
              description: "The approval_id from the APPROVAL_PENDING response",
            },
          },
          required: ["approval_id"],
          additionalProperties: false,
        },
      },
    ];
  }

  async handleMetaTool(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<[Array<{ type: string; text: string }>, boolean, string | null]> {
    if (name === "__apcore_approval_check") {
      return this.handleCheck(arguments_);
    }
    return [
      [{ type: "text", text: `Unknown approval meta-tool: ${name}` }],
      true,
      null,
    ];
  }

  private async handleCheck(
    args: Record<string, unknown>
  ): Promise<[Array<{ type: string; text: string }>, boolean, string | null]> {
    const approvalId = args["approval_id"];
    if (typeof approvalId !== "string" || !approvalId) {
      return [
        [{ type: "text", text: "approval_id is required" }],
        true,
        null,
      ];
    }
    try {
      const result = await this.handler.checkApproval(approvalId);
      const payload: Record<string, unknown> = {
        approval_id: approvalId,
        status: result.status,
      };
      if (result.reason !== undefined) {
        payload["reason"] = result.reason;
      }
      return [
        [{ type: "text", text: JSON.stringify(payload) }],
        false,
        null,
      ];
    } catch (err) {
      return [
        [{ type: "text", text: `Approval check failed: ${String(err)}` }],
        true,
        null,
      ];
    }
  }
}
