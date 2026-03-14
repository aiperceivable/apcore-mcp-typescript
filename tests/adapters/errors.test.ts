import { describe, it, expect } from "vitest";
import { ErrorMapper } from "../../src/adapters/errors.js";

const mapper = new ErrorMapper();

/**
 * Helper to create a ModuleError-like object with code, message, and details.
 */
function createModuleError(
  code: string,
  message: string,
  details: Record<string, unknown> | null = null,
  extra?: Record<string, unknown>,
) {
  const error = new Error(message) as Error & {
    code: string;
    details: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  error.code = code;
  error.details = details;
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      (error as Record<string, unknown>)[key] = value;
    }
  }
  return error;
}

describe("ErrorMapper", () => {
  // TC-ERROR-001: Unknown exception -> INTERNAL_ERROR
  it("maps unknown exceptions to INTERNAL_ERROR with generic message", () => {
    const result = mapper.toMcpError(new TypeError("something unexpected"));

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("Internal error occurred");
    expect(result.details).toBeNull();
  });

  // TC-ERROR-002: ModuleNotFoundError
  it("passes through MODULE_NOT_FOUND code and message", () => {
    const error = createModuleError(
      "MODULE_NOT_FOUND",
      "Module 'image.resize' not found",
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("MODULE_NOT_FOUND");
    expect(result.message).toBe("Module 'image.resize' not found");
    expect(result.details).toBeNull();
  });

  // TC-ERROR-003: SchemaValidationError with field details
  it("formats SchemaValidationError with field-level details", () => {
    const error = createModuleError(
      "SCHEMA_VALIDATION_ERROR",
      "Validation failed",
      {
        errors: [
          { field: "width", message: "must be a positive integer" },
          { field: "format", message: "must be one of: png, jpg, webp" },
        ],
      },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("SCHEMA_VALIDATION_ERROR");
    expect(result.message).toContain("Schema validation failed");
    expect(result.message).toContain("width: must be a positive integer");
    expect(result.message).toContain(
      "format: must be one of: png, jpg, webp",
    );
    expect(result.details).not.toBeNull();
  });

  // TC-ERROR-004: ACLDeniedError -> sanitized
  it("sanitizes ACL_DENIED to 'Access denied' without leaking caller info", () => {
    const error = createModuleError(
      "ACL_DENIED",
      "User admin@corp.com denied access to module secret.data",
      { caller: "admin@corp.com", module: "secret.data" },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("ACL_DENIED");
    expect(result.message).toBe("Access denied");
    expect(result.details).toBeNull();
    expect(result.message).not.toContain("admin@corp.com");
  });

  // TC-ERROR-005: ModuleTimeoutError
  it("passes through MODULE_TIMEOUT code and message", () => {
    const error = createModuleError(
      "MODULE_TIMEOUT",
      "Module execution timed out after 30s",
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("MODULE_TIMEOUT");
    expect(result.message).toBe("Module execution timed out after 30s");
  });

  // TC-ERROR-006: CallDepthExceededError -> INTERNAL_ERROR message
  it("maps CALL_DEPTH_EXCEEDED to generic internal error message", () => {
    const error = createModuleError(
      "CALL_DEPTH_EXCEEDED",
      "Call depth exceeded: 10 > max 5",
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("CALL_DEPTH_EXCEEDED");
    expect(result.message).toBe("Internal error occurred");
    expect(result.details).toBeNull();
  });

  // TC-ERROR-007: CircularCallError -> INTERNAL_ERROR message
  it("maps CIRCULAR_CALL to generic internal error message", () => {
    const error = createModuleError(
      "CIRCULAR_CALL",
      "Circular call detected: A -> B -> A",
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("CIRCULAR_CALL");
    expect(result.message).toBe("Internal error occurred");
    expect(result.details).toBeNull();
  });

  // TC-ERROR-008: CallFrequencyExceededError -> INTERNAL_ERROR message
  it("maps CALL_FREQUENCY_EXCEEDED to generic internal error message", () => {
    const error = createModuleError(
      "CALL_FREQUENCY_EXCEEDED",
      "Rate limit exceeded: 100 calls/min",
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("CALL_FREQUENCY_EXCEEDED");
    expect(result.message).toBe("Internal error occurred");
    expect(result.details).toBeNull();
  });

  // TC-ERROR-009: All responses have isError: true
  it("always sets isError to true for all error types", () => {
    const scenarios = [
      new TypeError("unexpected"),
      createModuleError("MODULE_NOT_FOUND", "not found"),
      createModuleError("SCHEMA_VALIDATION_ERROR", "invalid", {
        errors: [],
      }),
      createModuleError("ACL_DENIED", "denied"),
      createModuleError("MODULE_TIMEOUT", "timeout"),
      createModuleError("CALL_DEPTH_EXCEEDED", "depth"),
      createModuleError("CIRCULAR_CALL", "circular"),
      createModuleError("CALL_FREQUENCY_EXCEEDED", "rate"),
      "a plain string",
      42,
      null,
      undefined,
    ];

    for (const err of scenarios) {
      const result = mapper.toMcpError(err);
      expect(result.isError).toBe(true);
    }
  });

  // TC-ERROR-010: SchemaValidationError with empty errors array
  it("returns base message when errors array is empty", () => {
    const error = createModuleError(
      "SCHEMA_VALIDATION_ERROR",
      "Validation failed",
      { errors: [] },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("SCHEMA_VALIDATION_ERROR");
    expect(result.message).toBe("Schema validation failed");
  });

  // TC-ERROR-011: SchemaValidationError with null details
  it("returns base message when details is null", () => {
    const error = createModuleError(
      "SCHEMA_VALIDATION_ERROR",
      "Validation failed",
      null,
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("SCHEMA_VALIDATION_ERROR");
    expect(result.message).toBe("Schema validation failed");
  });

  // TC-ERROR-012: AI guidance fields extracted from error
  it("attaches AI guidance fields from enhanced ModuleError", () => {
    const error = createModuleError(
      "MODULE_EXECUTE_ERROR",
      "Something failed",
      null,
      {
        retryable: true,
        aiGuidance: "Try increasing the timeout",
        userFixable: true,
        suggestion: "Set timeout to 60s",
      },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.aiGuidance).toBe("Try increasing the timeout");
    expect(result.userFixable).toBe(true);
    expect(result.suggestion).toBe("Set timeout to 60s");
  });

  // TC-ERROR-013: AI guidance fields not attached when absent
  it("does not attach AI guidance fields when absent on error", () => {
    const error = createModuleError(
      "MODULE_EXECUTE_ERROR",
      "Something failed",
    );

    const result = mapper.toMcpError(error);

    expect(result.retryable).toBeUndefined();
    expect(result.aiGuidance).toBeUndefined();
    expect(result.userFixable).toBeUndefined();
    expect(result.suggestion).toBeUndefined();
  });

  // TC-ERROR-014: APPROVAL_PENDING narrows details to approvalId
  it("narrows APPROVAL_PENDING details to approvalId only", () => {
    const error = createModuleError(
      "APPROVAL_PENDING",
      "Approval pending",
      { approvalId: "abc-123", extra: "should-be-dropped" },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("APPROVAL_PENDING");
    expect(result.message).toBe("Approval pending");
    expect(result.details).toEqual({ approvalId: "abc-123" });
  });

  // TC-ERROR-014b: APPROVAL_PENDING narrows snake_case approval_id too
  it("narrows APPROVAL_PENDING details with snake_case approval_id", () => {
    const error = createModuleError(
      "APPROVAL_PENDING",
      "Approval pending",
      { approval_id: "snake-456", extra: "should-be-dropped" },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("APPROVAL_PENDING");
    expect(result.details).toEqual({ approvalId: "snake-456" });
  });

  // TC-ERROR-015: APPROVAL_PENDING with no approvalId in details
  it("returns null details for APPROVAL_PENDING without approvalId", () => {
    const error = createModuleError(
      "APPROVAL_PENDING",
      "Approval pending",
      { other: "data" },
    );

    const result = mapper.toMcpError(error);

    expect(result.details).toBeNull();
  });

  // TC-ERROR-016: APPROVAL_TIMEOUT marked retryable
  it("marks APPROVAL_TIMEOUT as retryable", () => {
    const error = createModuleError(
      "APPROVAL_TIMEOUT",
      "Approval timed out",
      null,
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("APPROVAL_TIMEOUT");
    expect(result.message).toBe("Approval timed out");
    expect(result.retryable).toBe(true);
  });

  // TC-ERROR-017: APPROVAL_DENIED extracts reason
  it("extracts reason from APPROVAL_DENIED details", () => {
    const error = createModuleError(
      "APPROVAL_DENIED",
      "Approval denied",
      { reason: "User declined", extra: "other" },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("APPROVAL_DENIED");
    expect(result.message).toBe("Approval denied");
    expect(result.details).toEqual({ reason: "User declined" });
  });

  // TC-ERROR-018: APPROVAL_DENIED without reason passes through details
  it("passes through APPROVAL_DENIED details when no reason", () => {
    const error = createModuleError(
      "APPROVAL_DENIED",
      "Approval denied",
      { something: "else" },
    );

    const result = mapper.toMcpError(error);

    expect(result.details).toEqual({ something: "else" });
  });

  // TC-ERROR-019b: ExecutionCancelledError by constructor name
  it("maps ExecutionCancelledError to EXECUTION_CANCELLED with retryable=true", () => {
    class ExecutionCancelledError extends Error {
      constructor() {
        super("cancelled");
        this.name = "ExecutionCancelledError";
      }
    }

    const result = mapper.toMcpError(new ExecutionCancelledError());

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("EXECUTION_CANCELLED");
    expect(result.message).toBe("Execution was cancelled");
    expect(result.details).toBeNull();
    expect(result.retryable).toBe(true);
  });

  // TC-ERROR-019c: ExecutionCancelledError by code property
  it("maps error with EXECUTION_CANCELLED code to EXECUTION_CANCELLED", () => {
    const error = createModuleError(
      "EXECUTION_CANCELLED",
      "Cancelled by user",
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("EXECUTION_CANCELLED");
    expect(result.message).toBe("Execution was cancelled");
    expect(result.retryable).toBe(true);
  });

  // TC-ERROR-019: Schema validation with AI guidance
  it("attaches AI guidance to schema validation errors", () => {
    const error = createModuleError(
      "SCHEMA_VALIDATION_ERROR",
      "Validation failed",
      { errors: [{ field: "name", message: "required" }] },
      { suggestion: "Add the name field" },
    );

    const result = mapper.toMcpError(error);

    expect(result.errorType).toBe("SCHEMA_VALIDATION_ERROR");
    expect(result.suggestion).toBe("Add the name field");
  });
});
