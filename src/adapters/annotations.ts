/**
 * AnnotationMapper - Maps apcore module annotations to MCP tool annotations.
 *
 * Converts between apcore's annotation format and the MCP protocol's
 * hint-based annotation system. Also provides description suffix generation
 * and approval requirement checking.
 */

import type { ModuleAnnotations, McpAnnotationsDict } from "../types.js";

/** Default annotation values matching apcore's ModuleAnnotations defaults. */
const DEFAULT_ANNOTATIONS: Record<string, boolean> = {
  readonly: false,
  destructive: false,
  idempotent: false,
  requiresApproval: false,
  openWorld: true,
  streaming: false,
  cacheable: false,
  paginated: false,
};

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
   * Generate a description suffix with safety warnings and annotation metadata.
   *
   * Produces:
   * 1. Safety warnings for destructive/approval/external operations.
   * 2. Machine-readable annotation block for non-default values.
   */
  toDescriptionSuffix(annotations: ModuleAnnotations | null): string {
    if (annotations === null) {
      return "";
    }

    const warnings: string[] = [];
    if (annotations.destructive) {
      warnings.push(
        "WARNING: DESTRUCTIVE - This operation may irreversibly modify or " +
          "delete data. Confirm with user before calling.",
      );
    }
    if (annotations.requiresApproval) {
      warnings.push(
        "REQUIRES APPROVAL: Human confirmation is required before execution.",
      );
    }

    const parts: string[] = [];
    if (annotations.readonly !== DEFAULT_ANNOTATIONS.readonly)
      parts.push(`readonly=${annotations.readonly}`);
    if (annotations.destructive !== DEFAULT_ANNOTATIONS.destructive)
      parts.push(`destructive=${annotations.destructive}`);
    if (annotations.idempotent !== DEFAULT_ANNOTATIONS.idempotent)
      parts.push(`idempotent=${annotations.idempotent}`);
    if (annotations.requiresApproval !== DEFAULT_ANNOTATIONS.requiresApproval)
      parts.push(`requires_approval=${annotations.requiresApproval}`);
    if (annotations.openWorld !== DEFAULT_ANNOTATIONS.openWorld)
      parts.push(`open_world=${annotations.openWorld}`);
    if (annotations.streaming !== DEFAULT_ANNOTATIONS.streaming)
      parts.push(`streaming=${annotations.streaming}`);
    if ((annotations.cacheable ?? false) !== DEFAULT_ANNOTATIONS.cacheable)
      parts.push(`cacheable=${annotations.cacheable}`);
    if ((annotations.paginated ?? false) !== DEFAULT_ANNOTATIONS.paginated)
      parts.push(`paginated=${annotations.paginated}`);

    if (warnings.length === 0 && parts.length === 0) {
      return "";
    }

    const sections: string[] = [];
    if (warnings.length > 0) {
      sections.push(warnings.join("\n"));
    }
    if (parts.length > 0) {
      sections.push(`[Annotations: ${parts.join(", ")}]`);
    }

    return "\n\n" + sections.join("\n\n");
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
