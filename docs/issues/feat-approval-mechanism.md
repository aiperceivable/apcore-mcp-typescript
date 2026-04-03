# Feature: Elicitation-Based Approval Mechanism

**Commit:** 9933904857360dfd2b7e220d500d15863d39eb27

### Problem
Previously, all MCP tools were executed immediately upon request, regardless of their impact. There was no built-in way to pause execution and request human confirmation for sensitive or destructive operations (e.g., deleting data, making financial transactions). This made the server less suitable for high-stakes environments where human oversight is mandatory.

### Why it needs to be fixed
Integrating an approval mechanism into the tool execution flow is essential for safety and trust. By leveraging the `elicitation` protocol, the server can interactively ask the user for confirmation or additional information before proceeding, ensuring that autonomous agents do not perform unintended actions.

### How it was resolved
1.  **Approval Adapter**: Created `src/adapters/approval.ts` containing the `ElicitationApprovalHandler`, which manages the state and communication of approval requests.
2.  **Executor Integration**: Updated the tool execution logic to check for the `requires_approval` annotation and invoke the approval handler when necessary.
3.  **Public API Support**: Added the `approvalHandler` parameter to both `serve()` and `asyncServe()` functions, allowing developers to provide custom approval logic or use the default elicitation-based handler.
4.  **Metadata Alignment**: Updated `AnnotationMapper` to generate safety warnings in tool descriptions for tools that require approval, alerting the LLM to the need for user confirmation.

### How it was verified
1.  **Approval Logic Tests**: Added `tests/adapters/approval.test.ts` to verify the state transitions (Pending -> Approved/Denied) and ensure that tool execution is correctly paused and resumed.
2.  **Integration Verification**: Verified that tools with the `requires_approval: true` annotation correctly trigger the elicitation flow when called via the MCP transport.
3.  **Documentation**: Updated the project `README.md` to document the new approval flow and provide examples of how to configure it.
