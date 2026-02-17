import { describe, it, expect } from "vitest";
import { ModuleIDNormalizer } from "../../src/adapters/idNormalizer.js";

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
});
