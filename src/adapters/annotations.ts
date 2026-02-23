/**
 * AnnotationMapper - Maps apcore module annotations to MCP tool annotations.
 *
 * Converts between apcore's annotation format and the MCP protocol's
 * hint-based annotation system. Also provides description suffix generation
 * and approval requirement checking.
 */

import type { ModuleAnnotations, McpAnnotationsDict } from "../types.js";

export class AnnotationMapper {
  /**
   * Convert apcore module annotations to MCP annotations dict.
   *
   * Returns default values when annotations are null:
   * - readOnlyHint: false
   * - destructiveHint: false
   * - idempotentHint: false
   * - openWorldHint: true
   * - title: null
   */
  toMcpAnnotations(annotations: ModuleAnnotations | null): McpAnnotationsDict {
    if (annotations === null) {
      return {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        title: null,
      };
    }

    return {
      readOnlyHint: annotations.readonly,
      destructiveHint: annotations.destructive,
      idempotentHint: annotations.idempotent,
      openWorldHint: annotations.openWorld,
      title: null,
    };
  }

  /**
   * Generate a description suffix string from annotations.
   *
   * Only includes annotation fields that differ from their default values:
   *   readonly=false, destructive=false, idempotent=false,
   *   requires_approval=false, open_world=true
   *
   * Returns a formatted string like:
   *   `\n\n[Annotations: readonly=true, idempotent=true]`
   *
   * Returns an empty string if annotations are null or all fields are defaults.
   */
  toDescriptionSuffix(annotations: ModuleAnnotations | null): string {
    if (annotations === null) {
      return "";
    }

    const DEFAULTS: Record<string, boolean> = {
      readonly: false,
      destructive: false,
      idempotent: false,
      requires_approval: false,
      open_world: true,
    };

    const parts: string[] = [];
    if (annotations.readonly !== DEFAULTS.readonly)
      parts.push(`readonly=${annotations.readonly}`);
    if (annotations.destructive !== DEFAULTS.destructive)
      parts.push(`destructive=${annotations.destructive}`);
    if (annotations.idempotent !== DEFAULTS.idempotent)
      parts.push(`idempotent=${annotations.idempotent}`);
    if (annotations.requiresApproval !== DEFAULTS.requires_approval)
      parts.push(`requires_approval=${annotations.requiresApproval}`);
    if (annotations.openWorld !== DEFAULTS.open_world)
      parts.push(`open_world=${annotations.openWorld}`);

    if (parts.length === 0) {
      return "";
    }

    return `\n\n[Annotations: ${parts.join(", ")}]`;
  }

  /**
   * Check whether the annotations indicate the module requires approval.
   *
   * Returns false if annotations are null.
   */
  hasRequiresApproval(annotations: ModuleAnnotations | null): boolean {
    if (annotations === null) {
      return false;
    }

    return annotations.requiresApproval;
  }
}
