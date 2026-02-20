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
   * Returns a formatted string like:
   *   `\n\n[Annotations: readonly=true, destructive=false, ...]`
   *
   * Returns an empty string if annotations are null.
   */
  toDescriptionSuffix(annotations: ModuleAnnotations | null): string {
    if (annotations === null) {
      return "";
    }

    const parts: string[] = [
      `readonly=${annotations.readonly}`,
      `destructive=${annotations.destructive}`,
      `idempotent=${annotations.idempotent}`,
      `requires_approval=${annotations.requiresApproval}`,
      `open_world=${annotations.openWorld}`,
    ];

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
