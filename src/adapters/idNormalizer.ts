/**
 * ModuleIDNormalizer - Converts between apcore module IDs and MCP tool names.
 *
 * apcore uses dot-separated module IDs (e.g. "myorg.tools.search")
 * while MCP tool names use hyphens (e.g. "myorg-tools-search").
 */

export class ModuleIDNormalizer {
  /**
   * Normalize an apcore module ID to an MCP-compatible tool name.
   *
   * Replaces dots (`.`) with hyphens (`-`).
   */
  normalize(moduleId: string): string {
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
