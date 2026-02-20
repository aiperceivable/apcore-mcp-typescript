/**
 * ModuleIDNormalizer - Converts between apcore module IDs and MCP tool names.
 *
 * apcore uses dot-separated module IDs (e.g. "myorg.tools.search")
 * while MCP tool names use hyphens (e.g. "myorg-tools-search").
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
}
