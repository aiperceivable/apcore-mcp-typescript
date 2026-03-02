/**
 * Adapter classes for converting between apcore and MCP/OpenAI formats.
 */

export { SchemaConverter } from "./schema.js";
export { AnnotationMapper } from "./annotations.js";
export { ErrorMapper } from "./errors.js";
export { ModuleIDNormalizer } from "./idNormalizer.js";
export { ElicitationApprovalHandler } from "./approval.js";
export type { ApprovalRequest, ApprovalResult } from "./approval.js";
