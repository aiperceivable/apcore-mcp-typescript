import { describe, it, expect } from "vitest";
import { SchemaConverter } from "../../src/adapters/schema.js";

const converter = new SchemaConverter();

/**
 * Helper to create a ModuleDescriptor-like fixture.
 */
function makeDescriptor(
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown> = {},
) {
  return {
    moduleId: "test.module",
    description: "Test module",
    inputSchema: inputSchema,
    outputSchema: outputSchema,
    annotations: null,
  };
}

describe("SchemaConverter", () => {
  // TC-SCHEMA-001: Simple schema without $ref
  it("preserves properties, types, required fields, and enums exactly", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        name: { type: "string", description: "User name" },
        age: { type: "integer", description: "User age" },
        role: { type: "string", enum: ["admin", "user", "guest"] },
      },
      required: ["name", "role"],
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result.type).toBe("object");
    expect(result.required).toEqual(["name", "role"]);

    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toEqual({ type: "string", description: "User name" });
    expect(props.age).toEqual({ type: "integer", description: "User age" });
    expect(props.role).toEqual({
      type: "string",
      enum: ["admin", "user", "guest"],
    });
  });

  // TC-SCHEMA-002: Schema with single-level $ref inlining
  it("inlines a single-level $ref and removes $defs", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        parameters: { $ref: "#/$defs/Parameters" },
      },
      $defs: {
        Parameters: {
          type: "object",
          properties: {
            width: { type: "integer" },
            height: { type: "integer" },
          },
        },
      },
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result["$defs"]).toBeUndefined();
    expect(result.properties).toBeDefined();

    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.parameters).toEqual({
      type: "object",
      properties: {
        width: { type: "integer" },
        height: { type: "integer" },
      },
    });
  });

  // TC-SCHEMA-003: Schema with nested $ref (A references B)
  it("resolves nested $ref chains (A references B)", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        config: { $ref: "#/$defs/Config" },
      },
      $defs: {
        Config: {
          type: "object",
          properties: {
            name: { type: "string" },
            output: { $ref: "#/$defs/OutputSettings" },
          },
        },
        OutputSettings: {
          type: "object",
          properties: {
            format: { type: "string" },
            quality: { type: "integer" },
          },
        },
      },
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result["$defs"]).toBeUndefined();

    const props = result.properties as Record<string, Record<string, unknown>>;
    const config = props.config as Record<string, unknown>;
    expect(config.type).toBe("object");

    const configProps = config.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(configProps.name).toEqual({ type: "string" });
    expect(configProps.output).toEqual({
      type: "object",
      properties: {
        format: { type: "string" },
        quality: { type: "integer" },
      },
    });
  });

  // TC-SCHEMA-004: Circular $ref detection
  it("throws on circular $ref (self-referencing TreeNode)", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        root: { $ref: "#/$defs/TreeNode" },
      },
      $defs: {
        TreeNode: {
          type: "object",
          properties: {
            value: { type: "string" },
            children: {
              type: "array",
              items: { $ref: "#/$defs/TreeNode" },
            },
          },
        },
      },
    });

    expect(() => converter.convertInputSchema(descriptor, { strict: false })).toThrow(
      "Circular $ref detected",
    );
  });

  // TC-SCHEMA-004b: Mutual circular $ref detection (A -> B -> A)
  it("throws on mutual circular $ref (A -> B -> A)", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        a: { $ref: "#/$defs/TypeA" },
      },
      $defs: {
        TypeA: {
          type: "object",
          properties: {
            b: { $ref: "#/$defs/TypeB" },
          },
        },
        TypeB: {
          type: "object",
          properties: {
            a: { $ref: "#/$defs/TypeA" },
          },
        },
      },
    });

    expect(() => converter.convertInputSchema(descriptor, { strict: false })).toThrow(
      "Circular $ref detected",
    );
  });

  // TC-SCHEMA-004c: Diamond pattern (same type in multiple non-circular positions)
  it("resolves same type used in multiple non-circular positions (diamond pattern)", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        first: { $ref: "#/$defs/Shared" },
        second: { $ref: "#/$defs/Shared" },
        nested: {
          type: "object",
          properties: {
            third: { $ref: "#/$defs/Shared" },
          },
        },
      },
      $defs: {
        Shared: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
        },
      },
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    const expected = { type: "object", properties: { value: { type: "string" } } };
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.first).toEqual(expected);
    expect(props.second).toEqual(expected);
    const nested = props.nested as Record<string, unknown>;
    const nestedProps = nested.properties as Record<string, Record<string, unknown>>;
    expect(nestedProps.third).toEqual(expected);
  });

  // TC-SCHEMA-005: Empty inputSchema
  it("converts empty inputSchema to {type: 'object', properties: {}}", () => {
    const descriptor = makeDescriptor({});

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result).toEqual({ type: "object", properties: {} });
  });

  // TC-SCHEMA-006: Strip $defs when no $ref references exist
  it("strips $defs even when no $ref references exist", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      $defs: {
        Unused: {
          type: "object",
          properties: { foo: { type: "string" } },
        },
      },
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result["$defs"]).toBeUndefined();
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toEqual({ type: "string" });
    expect(result.type).toBe("object");
  });

  // TC-SCHEMA-007: Schema with array items containing $ref
  it("inlines $ref inside array items", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { $ref: "#/$defs/Tag" },
        },
      },
      $defs: {
        Tag: {
          type: "object",
          properties: {
            label: { type: "string" },
            color: { type: "string" },
          },
        },
      },
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result["$defs"]).toBeUndefined();
    const props = result.properties as Record<string, Record<string, unknown>>;
    const tags = props.tags as Record<string, unknown>;
    expect(tags.type).toBe("array");
    expect(tags.items).toEqual({
      type: "object",
      properties: {
        label: { type: "string" },
        color: { type: "string" },
      },
    });
  });

  // TC-SCHEMA-008: Schema with oneOf containing $ref
  it("inlines $ref inside oneOf", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        source: {
          oneOf: [
            { $ref: "#/$defs/FileSource" },
            { $ref: "#/$defs/UrlSource" },
          ],
        },
      },
      $defs: {
        FileSource: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
        },
        UrlSource: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
          },
        },
      },
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result["$defs"]).toBeUndefined();
    const props = result.properties as Record<string, Record<string, unknown>>;
    const source = props.source as Record<string, unknown>;
    const oneOf = source.oneOf as Record<string, unknown>[];
    expect(oneOf).toHaveLength(2);
    expect(oneOf[0]).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
    });
    expect(oneOf[1]).toEqual({
      type: "object",
      properties: { url: { type: "string", format: "uri" } },
    });
  });

  // TC-SCHEMA-009: Ensure root type is object when missing
  it("adds type: 'object' when schema has properties but no type", () => {
    const descriptor = makeDescriptor({
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result.type).toBe("object");
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toEqual({ type: "string" });
    expect(result.required).toEqual(["name"]);
  });

  // TC-SCHEMA-010: Does not mutate original schema
  it("does not mutate the original schema object", () => {
    const originalSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        config: { $ref: "#/$defs/Config" },
      },
      $defs: {
        Config: {
          type: "object",
          properties: {
            value: { type: "integer" },
          },
        },
      },
    };

    // Deep copy for comparison
    const snapshotBefore = JSON.parse(JSON.stringify(originalSchema));

    const descriptor = makeDescriptor(originalSchema);
    converter.convertInputSchema(descriptor, { strict: false });

    // Original should be untouched
    expect(originalSchema).toEqual(snapshotBefore);
    expect(originalSchema["$defs"]).toBeDefined();
    expect(
      (originalSchema.properties as Record<string, unknown>).config,
    ).toEqual({ $ref: "#/$defs/Config" });
  });

  // TC-SCHEMA-011: outputSchema conversion works the same as inputSchema
  it("converts outputSchema the same way as inputSchema", () => {
    const descriptor = makeDescriptor(
      {},
      {
        type: "object",
        properties: {
          result: { $ref: "#/$defs/Result" },
        },
        $defs: {
          Result: {
            type: "object",
            properties: {
              status: { type: "string" },
              code: { type: "integer" },
            },
          },
        },
      },
    );

    const result = converter.convertOutputSchema(descriptor, { strict: false });

    expect(result["$defs"]).toBeUndefined();
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.result).toEqual({
      type: "object",
      properties: {
        status: { type: "string" },
        code: { type: "integer" },
      },
    });
  });

  // TC-SCHEMA-ERR-001: Invalid $ref format
  it("throws Error for invalid $ref format (not #/$defs/...)", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        data: { $ref: "#/definitions/SomeModel" },
      },
      $defs: {},
    });

    expect(() => converter.convertInputSchema(descriptor, { strict: false })).toThrow(
      "Invalid $ref format",
    );
  });

  // TC-SCHEMA-ERR-002: $ref to non-existent definition
  it("throws Error for $ref pointing to non-existent definition", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        data: { $ref: "#/$defs/NonExistent" },
      },
      $defs: {
        SomethingElse: { type: "object", properties: {} },
      },
    });

    expect(() => converter.convertInputSchema(descriptor, { strict: false })).toThrow(
      "$ref not found",
    );
  });

  // TC-SCHEMA-ERR-003: $ref with empty name
  it("throws Error for $ref with empty name after prefix", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        data: { $ref: "#/$defs/" },
      },
      $defs: {},
    });

    expect(() => converter.convertInputSchema(descriptor, { strict: false })).toThrow(
      "Invalid $ref format",
    );
  });

  // TC-SCHEMA-012: Preserves all JSON Schema types
  it("preserves all JSON Schema types including string, integer, number, boolean, array, object, null, enum, format, and description", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        str: { type: "string", description: "A string field" },
        int: { type: "integer" },
        num: { type: "number", format: "double" },
        bool: { type: "boolean" },
        arr: {
          type: "array",
          items: { type: "string" },
        },
        obj: {
          type: "object",
          properties: {
            nested: { type: "string" },
          },
        },
        nullable: { type: "null" },
        enumField: {
          type: "string",
          enum: ["a", "b", "c"],
        },
        formatted: {
          type: "string",
          format: "date-time",
          description: "ISO timestamp",
        },
      },
    });

    const result = converter.convertInputSchema(descriptor, { strict: false });

    expect(result.type).toBe("object");
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props.str).toEqual({ type: "string", description: "A string field" });
    expect(props.int).toEqual({ type: "integer" });
    expect(props.num).toEqual({ type: "number", format: "double" });
    expect(props.bool).toEqual({ type: "boolean" });
    expect(props.arr).toEqual({
      type: "array",
      items: { type: "string" },
    });
    expect(props.obj).toEqual({
      type: "object",
      properties: { nested: { type: "string" } },
    });
    expect(props.nullable).toEqual({ type: "null" });
    expect(props.enumField).toEqual({
      type: "string",
      enum: ["a", "b", "c"],
    });
    expect(props.formatted).toEqual({
      type: "string",
      format: "date-time",
      description: "ISO timestamp",
    });
  });

  // TC-SCHEMA-STRICT-001: strict mode injects additionalProperties:false at root
  it("strict mode sets additionalProperties:false on the root object", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: { name: { type: "string" } },
    });
    const result = converter.convertInputSchema(descriptor, { strict: true });
    expect(result.additionalProperties).toBe(false);
  });

  // TC-SCHEMA-STRICT-002: strict mode cascades into nested object properties
  it("strict mode sets additionalProperties:false on nested objects", () => {
    const descriptor = makeDescriptor({
      type: "object",
      properties: {
        profile: {
          type: "object",
          properties: { email: { type: "string" } },
        },
      },
    });
    const result = converter.convertInputSchema(descriptor, { strict: true });
    expect(result.additionalProperties).toBe(false);
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.profile.additionalProperties).toBe(false);
  });

  // TC-SCHEMA-STRICT-003: preserves explicit additionalProperties:true
  it("strict mode preserves user-set additionalProperties:true", () => {
    const descriptor = makeDescriptor({
      type: "object",
      additionalProperties: true,
      properties: {
        bag: {
          type: "object",
          additionalProperties: true,
          properties: {},
        },
      },
    });
    const result = converter.convertInputSchema(descriptor, { strict: true });
    expect(result.additionalProperties).toBe(true);
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.bag.additionalProperties).toBe(true);
  });

  // D11-002: strict injection must recurse into propertyNames, contains, prefixItems
  it("D11-002: strict mode recurses into propertyNames sub-schema", () => {
    // propertyNames here is an object schema (has no type but has properties)
    const descriptor = makeDescriptor({
      type: "object",
      propertyNames: {
        properties: { pattern: { type: "string" } },
      } as Record<string, unknown>,
      properties: {},
    });
    const result = converter.convertInputSchema(descriptor, { strict: true });
    const propertyNames = result["propertyNames"] as Record<string, unknown>;
    expect(propertyNames).toBeDefined();
    // The propertyNames sub-schema has properties with no type — treated as object-shaped
    expect(propertyNames["additionalProperties"]).toBe(false);
  });

  it("D11-002: strict mode recurses into prefixItems array", () => {
    const descriptor = makeDescriptor({
      type: "array",
      prefixItems: [
        { type: "object", properties: { x: { type: "number" } } },
        { type: "string" },
      ] as Record<string, unknown>[],
    });
    const result = converter.convertInputSchema(descriptor, { strict: true });
    const prefixItems = result["prefixItems"] as Record<string, unknown>[];
    expect(prefixItems).toBeDefined();
    expect(prefixItems[0]["additionalProperties"]).toBe(false);
    // string type — not object-shaped, so no additionalProperties
    expect(prefixItems[1]["additionalProperties"]).toBeUndefined();
  });

  it("D11-002: strict mode recurses into contains sub-schema", () => {
    const descriptor = makeDescriptor({
      type: "array",
      contains: {
        type: "object",
        properties: { id: { type: "string" } },
      } as Record<string, unknown>,
    });
    const result = converter.convertInputSchema(descriptor, { strict: true });
    const contains = result["contains"] as Record<string, unknown>;
    expect(contains).toBeDefined();
    expect(contains["additionalProperties"]).toBe(false);
  });
});
