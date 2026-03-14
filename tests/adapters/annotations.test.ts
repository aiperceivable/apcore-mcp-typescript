import { describe, it, expect } from "vitest";
import { AnnotationMapper } from "../../src/adapters/annotations.js";

const mapper = new AnnotationMapper();

const defaultAnnotations = {
  readonly: false,
  destructive: false,
  idempotent: false,
  requiresApproval: false,
  openWorld: true,
  streaming: false,
};

describe("AnnotationMapper", () => {
  describe("toMcpAnnotations", () => {
    // TC-ANNOT-001: null annotations -> defaults
    it("returns defaults when annotations are null", () => {
      const result = mapper.toMcpAnnotations(null);

      expect(result).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        title: null,
      });
    });

    // TC-ANNOT-002: destructive=true -> destructiveHint=true
    it("maps destructive=true to destructiveHint=true", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        destructive: true,
      });

      expect(result.destructiveHint).toBe(true);
      expect(result.readOnlyHint).toBe(false);
    });

    // TC-ANNOT-003: readonly=true -> readOnlyHint=true
    it("maps readonly=true to readOnlyHint=true", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        readonly: true,
      });

      expect(result.readOnlyHint).toBe(true);
    });

    // TC-ANNOT-004: idempotent=true -> idempotentHint=true
    it("maps idempotent=true to idempotentHint=true", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        idempotent: true,
      });

      expect(result.idempotentHint).toBe(true);
    });

    // TC-ANNOT-005: openWorld=false -> openWorldHint=false
    it("maps openWorld=false to openWorldHint=false", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        openWorld: false,
      });

      expect(result.openWorldHint).toBe(false);
    });

    // TC-ANNOT-006: All annotations set
    it("maps all annotation fields correctly when combined", () => {
      const result = mapper.toMcpAnnotations({
        readonly: true,
        destructive: true,
        idempotent: true,
        requiresApproval: true,
        openWorld: false,
      });

      expect(result).toEqual({
        readOnlyHint: true,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        title: null,
      });
    });
  });

  describe("hasRequiresApproval", () => {
    // TC-ANNOT-007: null -> false
    it("returns false when annotations are null", () => {
      expect(mapper.hasRequiresApproval(null)).toBe(false);
    });

    // TC-ANNOT-008: requiresApproval=true -> true
    it("returns true when requiresApproval is true", () => {
      expect(
        mapper.hasRequiresApproval({
          ...defaultAnnotations,
          requiresApproval: true,
        }),
      ).toBe(true);
    });

    // TC-ANNOT-009: requiresApproval=false -> false
    it("returns false when requiresApproval is false", () => {
      expect(
        mapper.hasRequiresApproval({
          ...defaultAnnotations,
          requiresApproval: false,
        }),
      ).toBe(false);
    });
  });

  describe("toDescriptionSuffix", () => {
    // TC-ANNOT-010: null -> ""
    it("returns empty string when annotations are null", () => {
      expect(mapper.toDescriptionSuffix(null)).toBe("");
    });

    // TC-ANNOT-011: only includes non-default annotation fields
    it("includes only annotation fields that differ from defaults", () => {
      const suffix = mapper.toDescriptionSuffix({
        readonly: true,
        destructive: false,
        idempotent: true,
        requiresApproval: false,
        openWorld: true,
        streaming: false,
      });

      expect(suffix).toContain("[Annotations:");
      expect(suffix).toContain("readonly=true");
      expect(suffix).toContain("idempotent=true");
      // Default values should NOT appear
      expect(suffix).not.toContain("destructive=false");
      expect(suffix).not.toContain("requires_approval=false");
      expect(suffix).not.toContain("open_world=true");
    });

    // TC-ANNOT-012: all defaults returns empty string
    it("returns empty string when all annotations are defaults", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
        streaming: false,
      });

      expect(suffix).toBe("");
    });

    // TC-ANNOT-013: non-default values produce suffix starting with \n\n
    it("starts with two newlines when non-default annotations present", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
        destructive: true,
        streaming: false,
      });

      expect(suffix.startsWith("\n\n")).toBe(true);
      expect(suffix).toContain("destructive=true");
    });

    // TC-ANNOT-014: all non-default values included
    it("includes all fields when all differ from defaults", () => {
      const suffix = mapper.toDescriptionSuffix({
        readonly: true,
        destructive: true,
        idempotent: true,
        requiresApproval: true,
        openWorld: false,
        streaming: false,
      });

      expect(suffix).toContain("readonly=true");
      expect(suffix).toContain("destructive=true");
      expect(suffix).toContain("idempotent=true");
      expect(suffix).toContain("requires_approval=true");
      expect(suffix).toContain("open_world=false");
    });

    // TC-ANNOT-015: streaming=true included in suffix
    it("includes streaming=true when streaming is non-default", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
        streaming: true,
      });

      expect(suffix).toContain("[Annotations:");
      expect(suffix).toContain("streaming=true");
    });

    // TC-ANNOT-016: streaming=false (default) not included
    it("does not include streaming=false since it is the default", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
        streaming: false,
      });

      expect(suffix).toBe("");
    });

    // TC-ANNOT-017: cacheable=true included in suffix
    it("includes cacheable=true when cacheable is non-default", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
        cacheable: true,
      });

      expect(suffix).toContain("[Annotations:");
      expect(suffix).toContain("cacheable=true");
    });

    // TC-ANNOT-018: cacheable omitted when default (false)
    it("does not include cacheable when it is the default", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
      });

      expect(suffix).not.toContain("cacheable");
    });

    // TC-ANNOT-019: paginated=true included in suffix
    it("includes paginated=true when paginated is non-default", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
        paginated: true,
      });

      expect(suffix).toContain("[Annotations:");
      expect(suffix).toContain("paginated=true");
    });

    // TC-ANNOT-020: paginated omitted when default (false)
    it("does not include paginated when it is the default", () => {
      const suffix = mapper.toDescriptionSuffix({
        ...defaultAnnotations,
      });

      expect(suffix).not.toContain("paginated");
    });
  });
});
