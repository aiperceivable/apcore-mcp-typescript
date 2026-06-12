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
  // TC-ERROR-001 [D10-001 / D10-002]: Unknown exception -> GENERAL_INTERNAL_ERROR (EM-6)
  it("maps unknown exceptions to canonical GENERAL_INTERNAL_ERROR envelope", () => {
    const result = mapper.toMcpError(new TypeError("something unexpected"));

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("GENERAL_INTERNAL_ERROR");
    expect(result.message).toBe("Internal error occurred");
    expect(result.details).toBeNull();
  });

  // [D10-001 / EM-6] internalErrorResponse helper emits the canonical envelope
  it("internalErrorResponse() returns the canonical envelope", async () => {
    const { internalErrorResponse } = await import("../../src/adapters/errors.js");
    expect(internalErrorResponse()).toEqual({
      isError: true,
      errorType: "GENERAL_INTERNAL_ERROR",
      message: "Internal error occurred",
      details: null,
    });
  });

  // [D9-004] toMcpErrorAny — ModuleError subclasses are forwarded to toMcpError
  // so structured error fields survive the generic-any entry point. Non-module
  // inputs still fall back to the canonical GENERAL_INTERNAL_ERROR envelope
  // (no leakage of message / class / stack).
  it("toMcpErrorAny forwards ModuleError subclasses to toMcpError", async () => {
    const apcore = await import("apcore-js");
    // ModuleError is the documented base class for all apcore module errors.
    const ModuleError = (apcore as Record<string, unknown>)["ModuleError"] as
      | (new (code: string, message: string, details?: unknown) => Error)
      | undefined;
    expect(ModuleError).toBeTypeOf("function");

    const err = new ModuleError!(
      "MODULE_NOT_FOUND",
      "Module 'image.resize' not found",
    );
    const result = mapper.toMcpErrorAny(err);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("MODULE_NOT_FOUND");
    expect(result.message).toBe("Module 'image.resize' not found");
  });

  it("toMcpErrorAny falls back to GENERAL_INTERNAL_ERROR for non-module errors", () => {
    const a = mapper.toMcpErrorAny(new TypeError("secret-XYZ"));
    const b = mapper.toMcpErrorAny(new RangeError("api-key-leak"));
    const c = mapper.toMcpErrorAny({ unexpected: "shape" });

    // Plain Error / non-module inputs all collapse to the canonical envelope,
    // never leaking the original message, class, or details.
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.errorType).toBe("GENERAL_INTERNAL_ERROR");
    expect(a.message).toBe("Internal error occurred");
    expect(a.details).toBeNull();
    expect(JSON.stringify(a)).not.toContain("secret-XYZ");
    expect(JSON.stringify(b)).not.toContain("api-key-leak");
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

  // TC-ERROR-014: APPROVAL_PENDING narrows snake_case approval_id to camelCase approvalId.
  // [D10-003] Upstream apcore SDKs always emit snake_case; the camelCase
  // input branch has been removed for cross-language parity.
  it("narrows APPROVAL_PENDING details from snake_case approval_id to approvalId", () => {
    const error = createModuleError(
      "APPROVAL_PENDING",
      "Approval pending",
      { approval_id: "abc-123", extra: "should-be-dropped" },
    );

    const result = mapper.toMcpError(error);

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe("APPROVAL_PENDING");
    expect(result.message).toBe("Approval pending");
    expect(result.details).toEqual({ approvalId: "abc-123" });
  });

  // [D10-003] camelCase approvalId input is no longer accepted — drops to null
  // to match Python/Rust which only recognize snake_case approval_id.
  it("drops camelCase approvalId source key (D10-003 parity)", () => {
    const error = createModuleError(
      "APPROVAL_PENDING",
      "Approval pending",
      { approvalId: "camel-789" },
    );

    const result = mapper.toMcpError(error);

    expect(result.details).toBeNull();
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

// [D10-003] Approval source-key contract: only snake_case approval_id is
// accepted; camelCase approvalId is dropped. This supersedes the older
// D10-011 dual-key handling test block which asserted both branches.
describe("D10-003: approval_id snake_case is the sole accepted source key", () => {
  it("handles snake_case approval_id (apcore-py/rs/js shared convention)", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError("APPROVAL_PENDING", "Approval needed", {
      approval_id: "xyz-456",
    });
    const result = mapper.toMcpError(error);
    expect(result.errorType).toBe("APPROVAL_PENDING");
    expect((result.details as Record<string, unknown>)?.approvalId).toBe("xyz-456");
  });

  it("drops the input when only camelCase approvalId is present", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError("APPROVAL_PENDING", "Approval needed", {
      approvalId: "abc-123",
    });
    const result = mapper.toMcpError(error);
    expect(result.errorType).toBe("APPROVAL_PENDING");
    expect(result.details).toBeNull();
  });
});

// D11-016: userFixable pass-through for DEPENDENCY_NOT_FOUND / DEPENDENCY_VERSION_MISMATCH.
// apcore-js >=0.24.0 sets userFixable on these error codes; the bridge passes it through
// via _attachAiGuidance.
describe("D11-016: userFixable pass-through for DEPENDENCY_NOT_FOUND and DEPENDENCY_VERSION_MISMATCH", () => {
  it("passes through userFixable: true for DEPENDENCY_NOT_FOUND", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError("DEPENDENCY_NOT_FOUND", "dep not found", null, { userFixable: true });
    const result = mapper.toMcpError(error);
    expect(result.userFixable).toBe(true);
  });

  it("passes through userFixable: true for DEPENDENCY_VERSION_MISMATCH", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError("DEPENDENCY_VERSION_MISMATCH", "version mismatch", null, { userFixable: true });
    const result = mapper.toMcpError(error);
    expect(result.userFixable).toBe(true);
  });
});

// D11-017: userFixable pass-through for VERSION_CONSTRAINT_INVALID / BINDING_* errors.
// apcore-js >=0.24.0 sets userFixable on these error codes; the bridge passes it through.
describe("D11-017: userFixable pass-through for VERSION_CONSTRAINT_INVALID and BINDING_* errors", () => {
  it("passes through userFixable: true for VERSION_CONSTRAINT_INVALID", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError("VERSION_CONSTRAINT_INVALID", "bad constraint", null, { userFixable: true });
    const result = mapper.toMcpError(error);
    expect(result.userFixable).toBe(true);
  });

  it("passes through userFixable: true for BINDING_SCHEMA_INFERENCE_FAILED", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError("BINDING_SCHEMA_INFERENCE_FAILED", "inference failed", null, { userFixable: true });
    const result = mapper.toMcpError(error);
    expect(result.userFixable).toBe(true);
  });
});

// apcore 0.20.0 sync alignment A-001: CIRCUIT_BREAKER_OPEN
describe("CIRCUIT_BREAKER_OPEN error mapping (apcore 0.20)", () => {
  it("maps CIRCUIT_BREAKER_OPEN to retryable=true with aiGuidance", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError(
      "CIRCUIT_BREAKER_OPEN",
      "Circuit open for module 'demo.module' — call rejected",
      { module_id: "demo.module" },
    );
    const result = mapper.toMcpError(error);
    expect(result.errorType).toBe("CIRCUIT_BREAKER_OPEN");
    expect(result.retryable).toBe(true);
    expect(typeof result.aiGuidance).toBe("string");
    expect(result.aiGuidance!.toLowerCase()).toContain("circuit");
  });

  it("preserves apcore-supplied aiGuidance verbatim when present", () => {
    const mapper = new ErrorMapper();
    const error = createModuleError(
      "CIRCUIT_BREAKER_OPEN",
      "Circuit open",
      null,
      { aiGuidance: "Custom recovery hint from apcore-js" },
    );
    const result = mapper.toMcpError(error);
    expect(result.aiGuidance).toBe("Custom recovery hint from apcore-js");
  });
});
