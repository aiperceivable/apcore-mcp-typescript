import { describe, it, expect } from "vitest";
import { AnnotationMapper } from "../../src/adapters/annotations.js";

const mapper = new AnnotationMapper();

const defaultAnnotations = {
  readonly: false,
  destructive: false,
  idempotent: false,
  requires_approval: false,
  open_world: true,
};

describe("AnnotationMapper", () => {
  describe("toMcpAnnotations", () => {
    // TC-ANNOT-001: null annotations -> defaults
    it("returns defaults when annotations are null", () => {
      const result = mapper.toMcpAnnotations(null);

      expect(result).toEqual({
        read_only_hint: false,
        destructive_hint: false,
        idempotent_hint: false,
        open_world_hint: true,
        title: null,
      });
    });

    // TC-ANNOT-002: destructive=true -> destructive_hint=true
    it("maps destructive=true to destructive_hint=true", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        destructive: true,
      });

      expect(result.destructive_hint).toBe(true);
      expect(result.read_only_hint).toBe(false);
    });

    // TC-ANNOT-003: readonly=true -> read_only_hint=true
    it("maps readonly=true to read_only_hint=true", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        readonly: true,
      });

      expect(result.read_only_hint).toBe(true);
    });

    // TC-ANNOT-004: idempotent=true -> idempotent_hint=true
    it("maps idempotent=true to idempotent_hint=true", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        idempotent: true,
      });

      expect(result.idempotent_hint).toBe(true);
    });

    // TC-ANNOT-005: open_world=false -> open_world_hint=false
    it("maps open_world=false to open_world_hint=false", () => {
      const result = mapper.toMcpAnnotations({
        ...defaultAnnotations,
        open_world: false,
      });

      expect(result.open_world_hint).toBe(false);
    });

    // TC-ANNOT-006: All annotations set
    it("maps all annotation fields correctly when combined", () => {
      const result = mapper.toMcpAnnotations({
        readonly: true,
        destructive: true,
        idempotent: true,
        requires_approval: true,
        open_world: false,
      });

      expect(result).toEqual({
        read_only_hint: true,
        destructive_hint: true,
        idempotent_hint: true,
        open_world_hint: false,
        title: null,
      });
    });
  });

  describe("hasRequiresApproval", () => {
    // TC-ANNOT-007: null -> false
    it("returns false when annotations are null", () => {
      expect(mapper.hasRequiresApproval(null)).toBe(false);
    });

    // TC-ANNOT-008: requires_approval=true -> true
    it("returns true when requires_approval is true", () => {
      expect(
        mapper.hasRequiresApproval({
          ...defaultAnnotations,
          requires_approval: true,
        }),
      ).toBe(true);
    });

    // TC-ANNOT-009: requires_approval=false -> false
    it("returns false when requires_approval is false", () => {
      expect(
        mapper.hasRequiresApproval({
          ...defaultAnnotations,
          requires_approval: false,
        }),
      ).toBe(false);
    });
  });

  describe("toDescriptionSuffix", () => {
    // TC-ANNOT-010: null -> ""
    it("returns empty string when annotations are null", () => {
      expect(mapper.toDescriptionSuffix(null)).toBe("");
    });

    // TC-ANNOT-011: annotations -> contains [Annotations: and all 5 fields
    it("includes [Annotations: and all five annotation fields", () => {
      const suffix = mapper.toDescriptionSuffix({
        readonly: true,
        destructive: false,
        idempotent: true,
        requires_approval: false,
        open_world: true,
      });

      expect(suffix).toContain("[Annotations:");
      expect(suffix).toContain("readonly=true");
      expect(suffix).toContain("destructive=false");
      expect(suffix).toContain("idempotent=true");
      expect(suffix).toContain("requires_approval=false");
      expect(suffix).toContain("open_world=true");
    });

    // TC-ANNOT-012: format starts with \n\n
    it("starts with two newlines", () => {
      const suffix = mapper.toDescriptionSuffix(defaultAnnotations);

      expect(suffix.startsWith("\n\n")).toBe(true);
    });
  });
});
