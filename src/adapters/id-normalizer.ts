/**
 * ModuleIDNormalizer - Converts between apcore module IDs and OpenAI tool names.
 *
 * apcore uses dot-separated module IDs (e.g. "myorg.tools.search").
 *
 * [MID-6] MCP tool names accept dots and hyphens (and dot-notation is the
 * apcore convention), so this normalizer is intended ONLY for the OpenAI
 * function-calling format, which restricts function names to `[a-zA-Z0-9_-]`.
 * Pre-fix doc here claimed "MCP tool names use hyphens" — that is incorrect
 * and contradicts the spec at `docs/features/openai-converter.md`. This
 * normalizer must NOT be applied on the MCP path.
 */

import { MODULE_ID_PATTERN } from "../types.js";

export class ModuleIDNormalizer {
  /**
   * Normalize an apcore module ID to an MCP-compatible tool name.
   *
   * Validates the module ID against MODULE_ID_PATTERN before converting.
   * Replaces dots (`.`) with hyphens (`-`).
   */
  normalize(moduleId: string): string {
    if (!MODULE_ID_PATTERN.test(moduleId)) {
      throw new Error(
        `Invalid module ID "${moduleId}": must match pattern ${MODULE_ID_PATTERN}`,
      );
    }
    return moduleId.replaceAll(".", "-");
  }

  /**
   * Denormalize an MCP tool name back to an apcore module ID.
   *
   * Replaces hyphens (`-`) with dots (`.`).
   */
  denormalize(toolName: string): string {
    return toolName.replaceAll("-", ".");
  }

  /**
   * Bijection-guarded variant of denormalize. [MID-5]
   *
   * Returns the denormalized module ID if `toolName` is a valid pre-image of
   * `normalize()` (i.e. the dash→dot replacement yields a string matching
   * MODULE_ID_PATTERN). Returns `null` for inputs that could not have been
   * produced by `normalize()`.
   *
   * Cross-language parity [D11-3]: validates the denormalized result against
   * the shared MODULE_ID_PATTERN so underscores within segments (e.g.
   * `"my_mod-v2"` → `"my_mod.v2"`) round-trip identically to Python/Rust.
   */
  tryDenormalize(toolName: string): string | null {
    if (!toolName || toolName.length === 0) return null;
    const denormalized = this.denormalize(toolName);
    if (!MODULE_ID_PATTERN.test(denormalized)) return null;
    return denormalized;
  }
}
