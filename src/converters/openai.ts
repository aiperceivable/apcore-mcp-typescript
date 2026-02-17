/**
 * OpenAIConverter - Converts apcore Registry modules to OpenAI-compatible tool definitions.
 *
 * Uses SchemaConverter, AnnotationMapper, and ModuleIDNormalizer internally
 * to produce function-calling tool definitions that conform to the OpenAI
 * chat completions API.
 */

import { SchemaConverter } from "../adapters/schema.js";
import { AnnotationMapper } from "../adapters/annotations.js";
import { ModuleIDNormalizer } from "../adapters/idNormalizer.js";
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
   * calls registry.get_definition() for each module ID, skips null
   * definitions (race-condition guard), and converts each descriptor.
   *
   * @param registry - apcore Registry with list() and get_definition() methods.
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

    for (const moduleId of moduleIds) {
      const descriptor = registry.get_definition(moduleId);
      if (descriptor === null) {
        continue;
      }
      tools.push(
        this.convertDescriptor(descriptor, { embedAnnotations, strict }),
      );
    }

    return tools;
  }

  /**
   * Convert a single ModuleDescriptor to an OpenAI tool definition.
   *
   * - Normalizes the module_id via ModuleIDNormalizer (dots -> dashes).
   * - Converts the input_schema via SchemaConverter.
   * - Optionally appends an annotation suffix to the description.
   * - Optionally applies strict-mode transformations to the schema.
   *
   * @param descriptor - Module descriptor with module_id, description,
   *                     input_schema, and optional annotations.
   * @param options    - Optional conversion flags.
   * @returns OpenAI-compatible tool definition object.
   */
  convertDescriptor(
    descriptor: ModuleDescriptor,
    options?: ConvertOptions,
  ): OpenAIToolDef {
    const embedAnnotations = options?.embedAnnotations ?? false;
    const strict = options?.strict ?? false;

    const name = this._idNormalizer.normalize(descriptor.module_id);
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
    return this._applyStrictRecursive(copy);
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
      const allPropertyNames = Object.keys(properties);

      // Make optional properties nullable and add them to required
      for (const propName of allPropertyNames) {
        const propSchema = properties[propName];

        // Remove default values
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
          }
        }

        // Recurse into nested properties
        properties[propName] = this._applyStrictRecursive(propSchema);
      }

      // All properties become required
      schema["required"] = allPropertyNames;
    }

    // Recurse into array items
    if (schema["type"] === "array" && schema["items"] !== undefined) {
      schema["items"] = this._applyStrictRecursive(
        schema["items"] as JsonSchema,
      );
    }

    return schema;
  }
}
