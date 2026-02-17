/**
 * ErrorMapper - Maps apcore errors to MCP-compatible error responses.
 *
 * Handles ModuleError instances with specific error codes, sanitizes
 * internal error details, and formats schema validation errors with
 * field-level detail.
 */

import type { McpErrorResponse } from "../types.js";

/** Internal error codes that should be sanitized to a generic message. */
const INTERNAL_ERROR_CODES = new Set([
  "CALL_DEPTH_EXCEEDED",
  "CIRCULAR_CALL",
  "CALL_FREQUENCY_EXCEEDED",
]);

export class ErrorMapper {
  /**
   * Convert an error to an MCP error response.
   *
   * Duck-types the error to check for ModuleError properties (code, message, details).
   * Applies sanitization and formatting rules based on the error code.
   */
  toMcpError(error: unknown): McpErrorResponse {
    // Duck-type check for ModuleError-like objects
    if (this._isModuleError(error)) {
      const code = error.code;
      const details = error.details;

      // Internal error codes -> generic message
      if (INTERNAL_ERROR_CODES.has(code)) {
        return {
          is_error: true,
          error_type: code,
          message: "Internal error occurred",
          details: null,
        };
      }

      // ACL denied -> sanitized access denied
      if (code === "ACL_DENIED") {
        return {
          is_error: true,
          error_type: "ACL_DENIED",
          message: "Access denied",
          details: null,
        };
      }

      // Schema validation error -> formatted with field-level details
      if (code === "SCHEMA_VALIDATION_ERROR") {
        const message = this._formatValidationError(details);
        return {
          is_error: true,
          error_type: "SCHEMA_VALIDATION_ERROR",
          message,
          details,
        };
      }

      // Other known ModuleError codes -> pass through
      return {
        is_error: true,
        error_type: code,
        message: error.message,
        details,
      };
    }

    // Unknown/unexpected exceptions -> generic error
    return {
      is_error: true,
      error_type: "INTERNAL_ERROR",
      message: "Internal error occurred",
      details: null,
    };
  }

  /**
   * Duck-type check for ModuleError-like objects.
   *
   * Checks for `code` (string), `message` (string), and `details` properties.
   */
  private _isModuleError(
    error: unknown,
  ): error is { code: string; message: string; details: Record<string, unknown> | null } {
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
