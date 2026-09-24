/**
 * Cross-language conformance: `$ref` sibling-key preservation in `SchemaConverter`.
 *
 * Drives the TypeScript implementation from the shared fixture at
 * `apcore-mcp/conformance/fixtures/schema_converter.json`. Pins the security
 * fix that a key written beside `$ref` (e.g. `x-sensitive`) survives
 * resolution instead of being silently discarded — see
 * `docs/features/schema-converter.md#ref-sibling-keys-are-preserved`.
 *
 * Called through the public `convertInputSchema(descriptor, { strict: false })`
 * path per the fixture's `entry_point`, so drivers do not need private-method
 * access and `additionalProperties` injection (a separate, already-pinned
 * concern) does not add noise to the expected output.
 */

import { describe, it, expect } from "vitest";
import { SchemaConverter } from "../src/adapters/schema.js";
import { loadFixture, skipMessage } from "./conformance-fixtures.js";

interface TestCase {
  id: string;
  description: string;
  input_schema: Record<string, unknown>;
  expected_inlined_schema: Record<string, unknown>;
}

interface ErrorCase {
  id: string;
  description: string;
  input_schema: Record<string, unknown>;
  expected_error_substring: string;
}

interface Fixture {
  test_cases: TestCase[];
  error_cases: ErrorCase[];
}

const FIXTURE = loadFixture<Fixture>("schema_converter.json");
const converter = new SchemaConverter();

/** Minimal ModuleDescriptor-like fixture, mirroring tests/adapters/schema.test.ts. */
function makeDescriptor(inputSchema: Record<string, unknown>) {
  return {
    moduleId: "conformance.schema_converter",
    description: "Conformance fixture subject",
    inputSchema,
    outputSchema: {},
    annotations: null,
  };
}

describe("conformance: schema converter $ref sibling keys", () => {
  if (!FIXTURE) {
    it.skip(skipMessage("schema_converter.json"), () => {});
    return;
  }

  for (const c of FIXTURE.test_cases) {
    it(`${c.id}: ${c.description}`, () => {
      const descriptor = makeDescriptor(c.input_schema);
      const result = converter.convertInputSchema(descriptor, { strict: false });
      expect(result).toEqual(c.expected_inlined_schema);
    });
  }

  for (const c of FIXTURE.error_cases) {
    it(`${c.id}: ${c.description}`, () => {
      const descriptor = makeDescriptor(c.input_schema);
      expect(() => converter.convertInputSchema(descriptor, { strict: false })).toThrow(
        c.expected_error_substring,
      );
    });
  }
});
