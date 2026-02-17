/**
 * SchemaConverter - Converts apcore module schemas to MCP-compatible JSON Schema.
 *
 * Handles deep copying, inlining $ref references, and ensuring schemas
 * have the required `type: "object"` for MCP tool input/output schemas.
 */

import type { JsonSchema, ModuleDescriptor } from "../types.js";

export class SchemaConverter {
  /**
   * Convert a module descriptor's input_schema to an MCP-compatible schema.
   */
  convertInputSchema(descriptor: ModuleDescriptor): JsonSchema {
    return this._convertSchema(descriptor.input_schema);
  }

  /**
   * Convert a module descriptor's output_schema to an MCP-compatible schema.
   */
  convertOutputSchema(descriptor: ModuleDescriptor): JsonSchema {
    return this._convertSchema(descriptor.output_schema);
  }

  /**
   * Apply all schema transformations: deep copy, inline $ref, ensure object type.
   */
  _convertSchema(schema: JsonSchema): JsonSchema {
    // Deep copy to avoid mutating the original
    const copied = structuredClone(schema);

    // Extract and remove $defs before inlining
    const defs = (copied["$defs"] as Record<string, JsonSchema>) ?? {};
    delete copied["$defs"];

    // Inline all $ref references
    const inlined = this._inlineRefs(copied, defs) as JsonSchema;

    // Ensure the top-level schema has type: "object"
    return this._ensureObjectType(inlined);
  }

  /**
   * Recursively inline `$ref` references using the provided $defs map.
   *
   * Handles dicts (objects), arrays, and primitive values.
   * Skips the `$defs` key itself during traversal.
   */
  _inlineRefs(
    node: unknown,
    defs: Record<string, JsonSchema>,
  ): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => this._inlineRefs(item, defs));
    }

    if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;

      // If this object is a $ref, resolve it
      if (typeof obj["$ref"] === "string") {
        const resolved = this._resolveRef(obj["$ref"], defs);
        // Recursively inline refs within the resolved schema
        return this._inlineRefs(resolved, defs);
      }

      // Otherwise, recurse into each key (skip $defs)
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === "$defs") {
          continue;
        }
        result[key] = this._inlineRefs(value, defs);
      }
      return result;
    }

    // Primitives pass through unchanged
    return node;
  }

  /**
   * Resolve a `$ref` path (e.g. `#/$defs/MyType`) against the $defs map.
   *
   * Returns a deep copy of the resolved definition to avoid mutation.
   * Throws Error if the ref format is invalid or the definition is not found.
   */
  _resolveRef(
    refPath: string,
    defs: Record<string, JsonSchema>,
  ): JsonSchema {
    const prefix = "#/$defs/";
    if (!refPath.startsWith(prefix)) {
      throw new Error(`Invalid $ref format: ${refPath}`);
    }

    const name = refPath.slice(prefix.length);
    if (!name) {
      throw new Error(`Invalid $ref format: ${refPath}`);
    }

    const definition = defs[name];
    if (definition === undefined) {
      throw new Error(`$ref not found: ${refPath}`);
    }

    // Return a deep copy to avoid shared mutation
    return structuredClone(definition);
  }

  /**
   * Ensure the schema has `type: "object"`.
   *
   * - Empty schema -> `{ type: "object", properties: {} }`
   * - Schema without `type` -> adds `type: "object"`
   */
  _ensureObjectType(schema: JsonSchema): JsonSchema {
    // Empty schema (no keys)
    if (Object.keys(schema).length === 0) {
      return { type: "object", properties: {} };
    }

    // If type is already set, return as-is
    if (schema["type"] !== undefined) {
      return schema;
    }

    // Add type: "object" if missing
    return { ...schema, type: "object" };
  }
}
