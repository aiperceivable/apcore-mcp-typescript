/**
 * OpenAIConverter - Converts apcore Registry modules to OpenAI-compatible tool definitions.
 *
 * Uses SchemaConverter, AnnotationMapper, and ModuleIDNormalizer internally
 * to produce function-calling tool definitions that conform to the OpenAI
 * chat completions API.
 */

import { SchemaConverter } from "../adapters/schema.js";
import { AnnotationMapper } from "../adapters/annotations.js";
import { ModuleIDNormalizer } from "../adapters/id-normalizer.js";
import type { Registry, ModuleDescriptor, OpenAIToolDef, JsonSchema } from "../types.js";

/** Options shared by convertRegistry and convertDescriptor. */
export interface ConvertOptions {
  /** If true, append annotation hints to the tool description. */
  embedAnnotations?: boolean;
  /** If true, apply OpenAI strict-mode transformations to the schema. */
  strict?: boolean;
}

/** Extended options accepted by convertRegistry (adds filtering). */
export interface ConvertRegistryOptions extends ConvertOptions {
  /** Optional tag filter forwarded to registry.list(). */
  tags?: string[];
  /** Optional prefix filter forwarded to registry.list(). */
  prefix?: string;
}

/**
 * Converts apcore Registry modules to OpenAI-compatible tool definitions.
 *
 * Each tool definition has the shape:
 * ```
 * {
 *   type: "function",
 *   function: {
 *     name: string,
 *     description: string,
 *     parameters: JsonSchema,
 *     strict?: boolean
 *   }
 * }
 * ```
 */
export class OpenAIConverter {
  private readonly _schemaConverter: SchemaConverter;
  private readonly _annotationMapper: AnnotationMapper;
  private readonly _idNormalizer: ModuleIDNormalizer;

  constructor() {
    this._schemaConverter = new SchemaConverter();
    this._annotationMapper = new AnnotationMapper();
    this._idNormalizer = new ModuleIDNormalizer();
  }

  /**
   * Convert all modules in a Registry to OpenAI tool definitions.
   *
   * Iterates registry.list() with optional tag/prefix filtering,
   * calls registry.getDefinition() for each module ID, skips null
   * definitions (race-condition guard), and converts each descriptor.
   *
   * @param registry - apcore Registry with list() and getDefinition() methods.
   * @param options  - Optional filtering and conversion options.
   * @returns Array of OpenAI-compatible tool definition objects.
   */
  convertRegistry(
    registry: Registry,
    options?: ConvertRegistryOptions,
  ): OpenAIToolDef[] {
    const tags = options?.tags;
    const prefix = options?.prefix;
    const embedAnnotations = options?.embedAnnotations;
    const strict = options?.strict;

    const moduleIds = registry.list({
      tags: tags ?? null,
      prefix: prefix ?? null,
    });

    const tools: OpenAIToolDef[] = [];
    // [OC-3] Track normalized names so we can detect collisions.
    // OpenAI function names must be unique post-normalization
    // (dot→hyphen). E.g. `a.b` and `a-b` both normalize to `a-b`;
    // without this guard two tools with identical function.name would
    // be emitted silently, producing undefined OpenAI behavior.
    const seenNames = new Map<string, string>();

    for (const moduleId of moduleIds) {
      const descriptor = registry.getDefinition(moduleId);
      if (descriptor === null) {
        continue;
      }
      const tool = this.convertDescriptor(descriptor, {
        embedAnnotations,
        strict,
      });
      const toolName = tool.function.name;
      const existing = seenNames.get(toolName);
      if (existing !== undefined && existing !== moduleId) {
        throw new Error(
          `OpenAI function-name collision: module ids "${existing}" and "${moduleId}" both ` +
            `normalize to "${toolName}". OpenAI requires unique function names; rename ` +
            `one of the modules to avoid the collision.`,
        );
      }
      seenNames.set(toolName, moduleId);
      tools.push(tool);
    }

    return tools;
  }

  /**
   * Convert a single ModuleDescriptor to an OpenAI tool definition.
   *
   * - Normalizes the moduleId via ModuleIDNormalizer (dots -> dashes).
   * - Converts the inputSchema via SchemaConverter.
   * - Optionally appends an annotation suffix to the description.
   * - Optionally applies strict-mode transformations to the schema.
   *
   * @param descriptor - Module descriptor with moduleId, description,
   *                     inputSchema, and optional annotations.
   * @param options    - Optional conversion flags.
   * @returns OpenAI-compatible tool definition object.
   */
  convertDescriptor(
    descriptor: ModuleDescriptor,
    options?: ConvertOptions,
  ): OpenAIToolDef {
    const embedAnnotations = options?.embedAnnotations ?? false;
    const strict = options?.strict ?? false;

    const name = this._idNormalizer.normalize(descriptor.moduleId);
    let parameters = this._schemaConverter.convertInputSchema(descriptor);

    // Build description with optional annotation suffix
    let description = descriptor.description;
    if (embedAnnotations) {
      const suffix = this._annotationMapper.toDescriptionSuffix(
        descriptor.annotations,
      );
      description += suffix;
    }

    // Apply strict mode transformations if requested
    if (strict) {
      parameters = this._applyStrictMode(parameters);
    }

    // Build the function definition
    const func: OpenAIToolDef["function"] = {
      name,
      description,
      parameters,
    };

    if (strict) {
      func.strict = true;
    }

    return {
      type: "function",
      function: func,
    };
  }

  /**
   * Convert a schema to OpenAI strict mode.
   *
   * Creates a deep copy and then recursively applies:
   * 1. `additionalProperties: false` on all objects with properties
   * 2. All properties become required
   * 3. Optional properties (not in original required) become nullable
   *    (type becomes [original, "null"])
   * 4. `default` values are removed
   * 5. Recurses into nested objects and array items
   *
   * @param schema - JSON Schema to transform.
   * @returns New schema with strict mode applied.
   */
  _applyStrictMode(schema: JsonSchema): JsonSchema {
    const copy = structuredClone(schema);
    // [D11-003] Step 1: promote x-llm-description → description recursively
    this._applyLlmDescriptions(copy);
    // [D11-003] Step 2: strip all x-* extension keys recursively
    this._stripExtensions(copy);
    // [D11-003] Steps 3 & 4 happen inside _applyStrictRecursive:
    //   - delete `default` from every sub-schema
    //   - sort `required` array alphabetically
    // [D11-012] Step 5: wrap optional $ref properties in oneOf nullable
    return this._applyStrictRecursive(copy);
  }

  /**
   * Recursively promote `x-llm-description` → `description` when present.
   * Mirrors Rust's `apply_strict_mode` step 1. [D11-003]
   */
  private _applyLlmDescriptions(schema: JsonSchema): void {
    if (typeof schema !== "object" || schema === null) return;
    const obj = schema as Record<string, unknown>;
    if (typeof obj["x-llm-description"] === "string") {
      obj["description"] = obj["x-llm-description"];
    }
    for (const value of Object.values(obj)) {
      if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            this._applyLlmDescriptions(item as JsonSchema);
          }
        } else {
          this._applyLlmDescriptions(value as JsonSchema);
        }
      }
    }
  }

  /**
   * Recursively strip all keys starting with `x-` from every schema node.
   * Mirrors Rust's `apply_strict_mode` step 2. [D11-003]
   */
  private _stripExtensions(schema: JsonSchema): void {
    if (typeof schema !== "object" || schema === null) return;
    const obj = schema as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key.startsWith("x-")) {
        delete obj[key];
      } else {
        const value = obj[key];
        if (typeof value === "object" && value !== null) {
          if (Array.isArray(value)) {
            for (const item of value) {
              this._stripExtensions(item as JsonSchema);
            }
          } else {
            this._stripExtensions(value as JsonSchema);
          }
        }
      }
    }
  }

  /**
   * Recursively apply strict mode transformations to a schema node (in place).
   *
   * @param schema - Schema node to transform.
   * @returns The transformed schema node.
   */
  private _applyStrictRecursive(schema: JsonSchema): JsonSchema {
    if (typeof schema !== "object" || schema === null) {
      return schema;
    }

    // Process object types that have properties
    if (schema["type"] === "object" && schema["properties"] !== undefined) {
      schema["additionalProperties"] = false;

      const properties = schema["properties"] as Record<string, JsonSchema>;
      const existingRequired = new Set<string>(
        (schema["required"] as string[] | undefined) ?? [],
      );
      // [D11-005] Sort property names alphabetically to match Python+Rust output.
      const allPropertyNames = Object.keys(properties).sort();

      // Make optional properties nullable and add them to required
      for (const propName of allPropertyNames) {
        const propSchema = properties[propName];

        // [D11-003] Remove default values from all sub-schemas
        delete propSchema["default"];

        // If not already required, make it nullable
        if (!existingRequired.has(propName)) {
          const currentType = propSchema["type"] as
            | string
            | string[]
            | undefined;
          if (currentType !== undefined && currentType !== "null") {
            if (Array.isArray(currentType)) {
              if (!currentType.includes("null")) {
                propSchema["type"] = [...currentType, "null"];
              }
            } else {
              propSchema["type"] = [currentType, "null"];
            }
          } else if (currentType === undefined) {
            // [D11-012] Optional $ref property (no `type`) — wrap in oneOf nullable
            // to match Python+Rust's handling of pure $ref or composition schemas.
            properties[propName] = { oneOf: [structuredClone(propSchema), { type: "null" }] } as JsonSchema;
            continue;
          }
        }

        // Recurse into nested properties
        properties[propName] = this._applyStrictRecursive(propSchema);
      }

      // [D11-003] All properties become required; [D11-005] sort alphabetically
      schema["required"] = allPropertyNames;
    }

    // Recurse into array items
    if (schema["type"] === "array" && schema["items"] !== undefined) {
      schema["items"] = this._applyStrictRecursive(
        schema["items"] as JsonSchema,
      );
    }

    // Recurse into prefixItems (JSON Schema 2020-12 tuple validation)
    if (schema["prefixItems"] !== undefined && Array.isArray(schema["prefixItems"])) {
      schema["prefixItems"] = (schema["prefixItems"] as JsonSchema[]).map(
        (item) => this._applyStrictRecursive(item)
      );
    }

    // Recurse into $defs (caller-provided schemas that still have definitions)
    if (schema["$defs"] && typeof schema["$defs"] === "object" && !Array.isArray(schema["$defs"])) {
      const defs = schema["$defs"] as Record<string, JsonSchema>;
      for (const [k, v] of Object.entries(defs)) {
        defs[k] = this._applyStrictRecursive(v);
      }
    }

    return schema;
  }
}
