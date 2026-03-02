/**
 * ElicitationApprovalHandler: bridges MCP elicitation to apcore's approval system.
 *
 * Uses the MCP elicit callback (injected into Context.data) to present
 * approval requests to the human user via the MCP client.
 */

import { MCP_ELICIT_KEY } from "../helpers.js";

export interface ApprovalRequest {
  moduleId: string;
  description?: string | null;
  arguments: Record<string, unknown>;
  context?: { data?: Record<string, unknown> } | null;
}

export interface ApprovalResult {
  status: "approved" | "rejected" | "timeout" | "pending";
  reason?: string | null;
}

export class ElicitationApprovalHandler {
  /**
   * Request approval via MCP elicitation.
   *
   * Extracts the elicit callback from request.context.data, builds
   * an approval message, and maps the elicit response to an ApprovalResult.
   */
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    const data = request.context?.data ?? null;
    if (data === null) {
      return { status: "rejected", reason: "No context available for elicitation" };
    }

    const elicitCallback = data[MCP_ELICIT_KEY] as
      | ((message: string) => Promise<{ action: string; content?: Record<string, unknown> } | null>)
      | undefined;

    if (!elicitCallback) {
      return { status: "rejected", reason: "No elicitation callback available" };
    }

    const message =
      `Approval required for tool: ${request.moduleId}\n\n` +
      `${request.description ?? ""}\n\n` +
      `Arguments: ${JSON.stringify(request.arguments)}`;

    let result: { action: string; content?: Record<string, unknown> } | null;
    try {
      result = await elicitCallback(message);
    } catch {
      return { status: "rejected", reason: "Elicitation request failed" };
    }

    if (result === null || result === undefined) {
      return { status: "rejected", reason: "Elicitation returned no response" };
    }

    const action = result.action;
    if (action === "accept") {
      return { status: "approved" };
    }

    return { status: "rejected", reason: `User action: ${action}` };
  }

  /**
   * Check status of an existing approval.
   *
   * Phase B (async polling) is not supported via MCP elicitation since
   * elicitation is stateless.
   */
  async checkApproval(_approvalId: string): Promise<ApprovalResult> {
    return { status: "rejected", reason: "Phase B not supported via MCP elicitation" };
  }
}
