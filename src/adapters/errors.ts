/**
 * ErrorMapper - Maps apcore errors to MCP-compatible error responses.
 *
 * Handles ModuleError instances with specific error codes, sanitizes
 * internal error details, formats schema validation errors with
 * field-level detail, and extracts AI guidance fields.
 */

import { ErrorCodes } from "../types.js";
import type { McpErrorResponse } from "../types.js";

/** Internal error codes that should be sanitized to a generic message. */
const INTERNAL_ERROR_CODES: Set<string> = new Set([
  ErrorCodes.CALL_DEPTH_EXCEEDED,
  ErrorCodes.CIRCULAR_CALL,
  ErrorCodes.CALL_FREQUENCY_EXCEEDED,
]);

/**
 * AI guidance field names on the MCP wire format (camelCase).
 * Both Python and TypeScript output identical camelCase keys in MCP responses.
 * Python reads snake_case from apcore errors and maps to camelCase on output.
 */
const _AI_GUIDANCE_FIELDS = ["retryable", "aiGuidance", "userFixable", "suggestion"] as const;

export class ErrorMapper {
  /**
   * Convert an error to an MCP error response.
   *
   * Duck-types the error to check for ModuleError properties (code, message, details).
   * Applies sanitization and formatting rules based on the error code.
   */
  toMcpError(error: unknown): McpErrorResponse {
    // ExecutionCancelledError: not a ModuleError subclass, check by name or code
    if (this._isExecutionCancelled(error)) {
      return {
        isError: true,
        errorType: ErrorCodes.EXECUTION_CANCELLED,
        message: "Execution was cancelled",
        details: null,
        retryable: true,
      };
    }

    // Duck-type check for ModuleError-like objects
    if (this._isModuleError(error)) {
      const code = error.code;
      const details = error.details;

      // Internal error codes -> generic message
      if (INTERNAL_ERROR_CODES.has(code)) {
        return {
          isError: true,
          errorType: code,
          message: "Internal error occurred",
          details: null,
        };
      }

      // ACL denied -> sanitized access denied
      if (code === ErrorCodes.ACL_DENIED) {
        return {
          isError: true,
          errorType: ErrorCodes.ACL_DENIED,
          message: "Access denied",
          details: null,
        };
      }

      // Schema validation error -> formatted with field-level details
      if (code === ErrorCodes.SCHEMA_VALIDATION_ERROR) {
        const message = this._formatValidationError(details);
        const result: McpErrorResponse = {
          isError: true,
          errorType: ErrorCodes.SCHEMA_VALIDATION_ERROR,
          message,
          details,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Approval pending -> narrow details to approvalId only
      // NOTE: apcore-js may use camelCase (approvalId) or snake_case (approval_id).
      // Check both to stay compatible with either convention.
      if (code === ErrorCodes.APPROVAL_PENDING) {
        const idKey = details && "approvalId" in details
          ? "approvalId"
          : details && "approval_id" in details
            ? "approval_id"
            : null;
        const narrowed = idKey
          ? { approvalId: details![idKey] }
          : null;
        const result: McpErrorResponse = {
          isError: true,
          errorType: code,
          message: error.message,
          details: narrowed,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Approval timeout -> mark as retryable
      if (code === ErrorCodes.APPROVAL_TIMEOUT) {
        const result: McpErrorResponse = {
          isError: true,
          errorType: code,
          message: error.message,
          details,
          retryable: true,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Approval denied -> extract reason from details
      if (code === ErrorCodes.APPROVAL_DENIED) {
        const reason = details ? (details.reason as string | undefined) : undefined;
        const result: McpErrorResponse = {
          isError: true,
          errorType: code,
          message: error.message,
          details: reason ? { reason } : details,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Config env map conflict -> formatted message with env_var
      if (code === ErrorCodes.CONFIG_ENV_MAP_CONFLICT) {
        const envVar = details?.env_var ?? "unknown";
        const result: McpErrorResponse = {
          isError: true,
          errorType: code,
          message: `Config env map conflict: ${String(envVar)}`,
          details,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Pipeline abort -> formatted message with step
      if (code === ErrorCodes.PIPELINE_ABORT) {
        const step = details?.step ?? "unknown";
        const result: McpErrorResponse = {
          isError: true,
          errorType: code,
          message: `Pipeline aborted at step: ${String(step)}`,
          details,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Step not found -> formatted message
      if (code === ErrorCodes.STEP_NOT_FOUND) {
        const result: McpErrorResponse = {
          isError: true,
          errorType: code,
          message: `Pipeline step not found: ${error.message}`,
          details,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Version incompatible -> formatted message
      if (code === ErrorCodes.VERSION_INCOMPATIBLE) {
        const result: McpErrorResponse = {
          isError: true,
          errorType: code,
          message: `Version incompatible: ${error.message}`,
          details,
        };
        this._attachAiGuidance(error, result);
        return result;
      }

      // Other known ModuleError codes -> pass through
      const result: McpErrorResponse = {
        isError: true,
        errorType: code,
        message: error.message,
        details,
      };
      this._attachAiGuidance(error, result);
      return result;
    }

    // Unknown/unexpected exceptions -> generic error
    return {
      isError: true,
      errorType: ErrorCodes.INTERNAL_ERROR,
      message: "Internal error occurred",
      details: null,
    };
  }

  /**
   * Extract AI guidance fields from error and attach non-undefined values to result.
   */
  private _attachAiGuidance(
    error: Record<string, unknown>,
    result: McpErrorResponse,
  ): void {
    for (const field of _AI_GUIDANCE_FIELDS) {
      const value = (error as Record<string, unknown>)[field];
      if (value !== undefined && value !== null && result[field] === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any)[field] = value;
      }
    }
  }

  /**
   * Check for ExecutionCancelledError by name or code property.
   */
  private _isExecutionCancelled(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const obj = error as Record<string, unknown>;
    if (obj.constructor?.name === "ExecutionCancelledError") return true;
    if (obj["code"] === ErrorCodes.EXECUTION_CANCELLED) return true;
    return false;
  }

  /**
   * Duck-type check for ModuleError-like objects.
   *
   * Checks for `code` (string), `message` (string), and `details` properties.
   */
  private _isModuleError(
    error: unknown,
  ): error is { code: string; message: string; details: Record<string, unknown> | null; [key: string]: unknown } {
    if (error === null || typeof error !== "object") {
      return false;
    }

    const obj = error as Record<string, unknown>;
    return (
      typeof obj["code"] === "string" &&
      typeof obj["message"] === "string" &&
      "details" in obj
    );
  }

  /**
   * Format a schema validation error message with field-level details.
   *
   * Extracts the `errors` array from details and formats each entry
   * as "field: message" lines appended to the base message.
   */
  private _formatValidationError(
    details: Record<string, unknown> | null,
  ): string {
    const baseMessage = "Schema validation failed";

    if (details === null) {
      return baseMessage;
    }

    const errors = details["errors"];
    if (!Array.isArray(errors) || errors.length === 0) {
      return baseMessage;
    }

    const fieldErrors = errors
      .map((err) => {
        if (err !== null && typeof err === "object") {
          const entry = err as Record<string, unknown>;
          const field = entry["field"] ?? "unknown";
          const message = entry["message"] ?? "validation error";
          return `  ${String(field)}: ${String(message)}`;
        }
        return `  ${String(err)}`;
      })
      .join("\n");

    return `${baseMessage}:\n${fieldErrors}`;
  }
}
