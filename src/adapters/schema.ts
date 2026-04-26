/**
 * SchemaConverter - Converts apcore module schemas to MCP-compatible JSON Schema.
 *
 * Handles deep copying, inlining $ref references, and ensuring schemas
 * have the required `type: "object"` for MCP tool input/output schemas.
 */

import type { JsonSchema, ModuleDescriptor } from "../types.js";

export interface ConvertSchemaOptions {
  strict?: boolean;
}

/**
 * [SC-1] Maximum recursion depth for $ref inlining and schema descent.
 * Matches Python's _MAX_REF_DEPTH and Rust's MAX_REF_DEPTH (32 levels).
 * Prevents stack overflow on pathological-but-legal acyclic schemas
 * (e.g. a chain of 100,000 distinct $defs each pointing to the next).
 */
const MAX_REF_DEPTH = 32;

export class SchemaConverter {
  /**
   * Convert a module descriptor's inputSchema to an MCP-compatible schema.
   */
  convertInputSchema(
    descriptor: ModuleDescriptor,
    options?: ConvertSchemaOptions,
  ): JsonSchema {
    return this._convertSchema(descriptor.inputSchema, options);
  }

  /**
   * Convert a module descriptor's outputSchema to an MCP-compatible schema.
   */
  convertOutputSchema(
    descriptor: ModuleDescriptor,
    options?: ConvertSchemaOptions,
  ): JsonSchema {
    return this._convertSchema(descriptor.outputSchema, options);
  }

  /**
   * Apply all schema transformations: deep copy, inline $ref, ensure object type.
   */
  _convertSchema(schema: JsonSchema, options?: ConvertSchemaOptions): JsonSchema {
    // Deep copy to avoid mutating the original
    const copied = structuredClone(schema);

    // Extract and remove $defs before inlining
    const defs = (copied["$defs"] as Record<string, JsonSchema>) ?? {};
    delete copied["$defs"];

    // Inline all $ref references (with circular ref detection)
    const inlined = this._inlineRefs(copied, defs, new Set<string>(), 0) as JsonSchema;

    // Ensure the top-level schema has type: "object"
    const normalized = this._ensureObjectType(inlined);

    // [SC-11] Default strict=true to match Python and Rust SDKs. Pre-fix
    // TS defaulted to false (undefined → falsy), silently producing
    // permissive schemas. Callers that explicitly want non-strict must
    // now pass `{ strict: false }`.
    const strict = options?.strict ?? true;
    if (strict) {
      return this._applyStrict(normalized) as JsonSchema;
    }
    return normalized;
  }

  /**
   * Recursively set `additionalProperties: false` on every object-shaped
   * schema node that does not already specify `additionalProperties`.
   *
   * A node is treated as an object schema when ANY of:
   *   - `type === "object"`
   *   - `Array.isArray(type) && type.includes("object")`
   *   - `"properties" in node` AND the declared scalar `type` (if any) isn't
   *     a non-object scalar (string/number/integer/boolean/null)
   *
   * Recurses only into known subschema slots. Opaque value slots like
   * `enum`, `const`, `examples`, `default` are left untouched.
   */
  _applyStrict(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => this._applyStrict(item));
    }
    if (node === null || typeof node !== "object") {
      return node;
    }

    const obj = node as Record<string, unknown>;
    const result: Record<string, unknown> = { ...obj };

    // Recurse into subschema slots only
    if ("properties" in result && result.properties !== null && typeof result.properties === "object" && !Array.isArray(result.properties)) {
      const props = result.properties as Record<string, unknown>;
      const newProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        newProps[k] = this._applyStrict(v);
      }
      result.properties = newProps;
    }
    if ("patternProperties" in result && result.patternProperties !== null && typeof result.patternProperties === "object" && !Array.isArray(result.patternProperties)) {
      const pp = result.patternProperties as Record<string, unknown>;
      const newPP: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(pp)) {
        newPP[k] = this._applyStrict(v);
      }
      result.patternProperties = newPP;
    }
    if ("$defs" in result && result.$defs !== null && typeof result.$defs === "object" && !Array.isArray(result.$defs)) {
      const defs = result.$defs as Record<string, unknown>;
      const newDefs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(defs)) {
        newDefs[k] = this._applyStrict(v);
      }
      result.$defs = newDefs;
    }
    if ("definitions" in result && result.definitions !== null && typeof result.definitions === "object" && !Array.isArray(result.definitions)) {
      const defs = result.definitions as Record<string, unknown>;
      const newDefs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(defs)) {
        newDefs[k] = this._applyStrict(v);
      }
      result.definitions = newDefs;
    }
    if ("items" in result) {
      result.items = this._applyStrict(result.items);
    }
    if ("additionalProperties" in result && typeof result.additionalProperties === "object" && result.additionalProperties !== null) {
      result.additionalProperties = this._applyStrict(result.additionalProperties);
    }
    if ("not" in result) {
      result.not = this._applyStrict(result.not);
    }
    for (const key of ["oneOf", "anyOf", "allOf"] as const) {
      if (Array.isArray(result[key])) {
        result[key] = (result[key] as unknown[]).map((v) => this._applyStrict(v));
      }
    }
    for (const key of ["if", "then", "else"] as const) {
      if (key in result) {
        result[key] = this._applyStrict(result[key]);
      }
    }

    // Decide whether this node is object-shaped
    const type = result["type"];
    const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean", "null"]);
    let isObjectShaped = false;
    if (type === "object") {
      isObjectShaped = true;
    } else if (Array.isArray(type) && type.includes("object")) {
      isObjectShaped = true;
    } else if (type === undefined && "properties" in result) {
      isObjectShaped = true;
    } else if (typeof type === "string" && !SCALAR_TYPES.has(type) && "properties" in result) {
      // Unknown string type with properties — treat as object
      isObjectShaped = true;
    }

    if (isObjectShaped && !("additionalProperties" in result)) {
      result["additionalProperties"] = false;
    }

    return result;
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
    activeRefs: Set<string>,
    depth: number = 0,
  ): unknown {
    // [SC-1] Cap recursion at MAX_REF_DEPTH to match Python+Rust.
    if (depth > MAX_REF_DEPTH) {
      throw new Error(
        `Maximum schema recursion depth (${MAX_REF_DEPTH}) exceeded`,
      );
    }
    if (Array.isArray(node)) {
      return node.map((item) =>
        this._inlineRefs(item, defs, activeRefs, depth + 1),
      );
    }

    if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;

      // If this object is a $ref, resolve it
      if (typeof obj["$ref"] === "string") {
        const refPath = obj["$ref"];

        // Detect circular references
        if (activeRefs.has(refPath)) {
          throw new Error(`Circular $ref detected: ${refPath}`);
        }

        const resolved = this._resolveRef(refPath, defs);

        // Track this ref as active during recursion
        activeRefs.add(refPath);
        try {
          const result = this._inlineRefs(resolved, defs, activeRefs, depth + 1);
          return result;
        } finally {
          // [SC-2] Use try/finally so an exception mid-recursion doesn't
          // leave activeRefs poisoned for subsequent sibling branches.
          activeRefs.delete(refPath);
        }
      }

      // Otherwise, recurse into each key (skip $defs)
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === "$defs") {
          continue;
        }
        result[key] = this._inlineRefs(value, defs, activeRefs, depth + 1);
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
