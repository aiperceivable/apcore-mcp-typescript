import { describe, it, expect } from "vitest";
import { ModuleIDNormalizer } from "../../src/adapters/id-normalizer.js";

const normalizer = new ModuleIDNormalizer();

describe("ModuleIDNormalizer", () => {
  describe("normalize", () => {
    // Dots to hyphens
    it('normalizes "image.resize" to "image-resize"', () => {
      expect(normalizer.normalize("image.resize")).toBe("image-resize");
    });

    it('normalizes "comfyui.image.resize.v2" to "comfyui-image-resize-v2"', () => {
      expect(normalizer.normalize("comfyui.image.resize.v2")).toBe(
        "comfyui-image-resize-v2",
      );
    });

    it('returns "ping" unchanged when there are no dots', () => {
      expect(normalizer.normalize("ping")).toBe("ping");
    });
  });

  describe("denormalize", () => {
    // Hyphens to dots
    it('denormalizes "image-resize" to "image.resize"', () => {
      expect(normalizer.denormalize("image-resize")).toBe("image.resize");
    });

    it('denormalizes "comfyui-image-resize-v2" to "comfyui.image.resize.v2"', () => {
      expect(normalizer.denormalize("comfyui-image-resize-v2")).toBe(
        "comfyui.image.resize.v2",
      );
    });

    it('returns "ping" unchanged when there are no hyphens', () => {
      expect(normalizer.denormalize("ping")).toBe("ping");
    });
  });

  describe("roundtrip", () => {
    it("returns the original module ID after normalize then denormalize", () => {
      const moduleIds = [
        "image.resize",
        "comfyui.image.resize.v2",
        "ping",
        "org.tools.search.v3",
        "a.b.c.d.e",
      ];

      for (const id of moduleIds) {
        const normalized = normalizer.normalize(id);
        const denormalized = normalizer.denormalize(normalized);
        expect(denormalized).toBe(id);
      }
    });
  });

  // [MID-5] tryDenormalize is the bijection-guarded variant of denormalize.
  // Plain denormalize is lenient and only round-trips on the image of
  // normalize. tryDenormalize returns null for inputs that are not valid
  // pre-images, useful for sanitizing untrusted tool-call responses.
  describe("MID-5: tryDenormalize bijection guard", () => {
    it("round-trips a normalized id back to the original", () => {
      const normalized = normalizer.normalize("image.resize");
      expect(normalizer.tryDenormalize(normalized)).toBe("image.resize");
    });

    it.each([
      "Image-Resize",
      "--bad",
      "foo--bar",
      "-foo",
      "foo-",
      "1foo",
      "",
    ])("returns null for invalid pre-image %s", (toolName) => {
      expect(normalizer.tryDenormalize(toolName)).toBeNull();
    });

    it("accepts inputs with no dashes", () => {
      expect(normalizer.tryDenormalize("ping")).toBe("ping");
    });

    // [D11-3] Cross-language parity: Python/Rust accept underscores within
    // segments per MODULE_ID_PATTERN. The local NORMALIZED_PATTERN used to
    // forbid them, causing tryDenormalize("my_mod-v2") to return null while
    // Python/Rust returned "my_mod.v2".
    it("accepts underscores within segments (cross-language parity)", () => {
      expect(normalizer.tryDenormalize("my_mod-v2")).toBe("my_mod.v2");
    });

    it("round-trips an id with underscore segments", () => {
      const normalized = normalizer.normalize("my_org.tools.search_v2");
      expect(normalizer.tryDenormalize(normalized)).toBe(
        "my_org.tools.search_v2",
      );
    });

    it("plain denormalize remains lenient on invalid inputs", () => {
      expect(normalizer.denormalize("Image-Resize")).toBe("Image.Resize");
      expect(normalizer.denormalize("foo--bar")).toBe("foo..bar");
    });
  });
});
