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
) {
  const error = new Error(message) as Error & {
    code: string;
    details: Record<string, unknown> | null;
  };
  error.code = code;
  error.details = details;
  return error;
}

describe("ErrorMapper", () => {
  // TC-ERROR-001: Unknown exception -> INTERNAL_ERROR
  it("maps unknown exceptions to INTERNAL_ERROR with generic message", () => {
    const result = mapper.toMcpError(new TypeError("something unexpected"));

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("INTERNAL_ERROR");
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("MODULE_NOT_FOUND");
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("SCHEMA_VALIDATION_ERROR");
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("ACL_DENIED");
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("MODULE_TIMEOUT");
    expect(result.message).toBe("Module execution timed out after 30s");
  });

  // TC-ERROR-006: CallDepthExceededError -> INTERNAL_ERROR message
  it("maps CALL_DEPTH_EXCEEDED to generic internal error message", () => {
    const error = createModuleError(
      "CALL_DEPTH_EXCEEDED",
      "Call depth exceeded: 10 > max 5",
    );

    const result = mapper.toMcpError(error);

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("CALL_DEPTH_EXCEEDED");
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("CIRCULAR_CALL");
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("CALL_FREQUENCY_EXCEEDED");
    expect(result.message).toBe("Internal error occurred");
    expect(result.details).toBeNull();
  });

  // TC-ERROR-009: All responses have is_error: true
  it("always sets is_error to true for all error types", () => {
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
      expect(result.is_error).toBe(true);
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("SCHEMA_VALIDATION_ERROR");
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

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("SCHEMA_VALIDATION_ERROR");
    expect(result.message).toBe("Schema validation failed");
  });
});
