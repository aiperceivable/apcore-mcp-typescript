/** Issue #20: real discovery, preflight and execution share one input contract. */
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { Executor, Registry } from "apcore-js";
import { MCPServerFactory } from "../src/server/factory.js";
import { ExecutionRouter } from "../src/server/router.js";
import { loadFixture, skipMessage } from "./conformance-fixtures.js";

interface ContractCase {
  id: string;
  input_schema: Record<string, unknown>;
  samples: Array<{ id: string; arguments: Record<string, unknown>; valid: boolean }>;
}
const fixture = loadFixture<{
  schema_cases: ContractCase[];
  root_schema_cases: Array<{ id: string; input_schema: Record<string, unknown>; accepted: boolean }>;
}>("mcp_input_contract.json");

describe("MCP input contract", () => {
  if (!fixture) {
    it.skip(skipMessage("mcp_input_contract.json"), () => {});
    return;
  }
  for (const c of fixture.root_schema_cases) {
    it(`root schema: ${c.id}`, async () => {
      const schema = structuredClone(c.input_schema);
      const registry = new Registry();
      registry.register("demo.echo", {
        description: "Echo inputs", inputSchema: schema, outputSchema: { type: "object" },
        execute(inputs: Record<string, unknown>) { return inputs; },
      } as never);
      const descriptor = registry.getDefinition("demo.echo")!;
      const factory = new MCPServerFactory();
      if (c.accepted) {
        const tool = factory.buildTool(descriptor);
        expect(tool.inputSchema.type).toBe("object");
        expect(factory.buildTools(registry)).toHaveLength(1);
        const ajv = new Ajv({ strict: false });
        expect(ajv.compile(schema)({})).toBe(true);
        expect(ajv.compile(tool.inputSchema)({})).toBe(true);
        expect((await Executor.fromRegistry(registry).validate("demo.echo", {})).valid).toBe(true);
      } else {
        expect(() => factory.buildTool(descriptor)).toThrow("MCP input schema must allow an object root");
        expect(factory.buildTools(registry)).toEqual([]);
      }
      expect(descriptor.inputSchema).toEqual(schema);
    });
  }
  for (const c of fixture.schema_cases) {
    for (const validateInputs of [false, true]) {
      it(`${c.id}, validateInputs=${validateInputs}`, async () => {
        const schema = structuredClone(c.input_schema);
        const registry = new Registry();
        registry.register("demo.echo", {
          description: "Echo validated inputs and preserve an omitted limit's default",
          inputSchema: schema,
          outputSchema: { type: "object" },
          execute(inputs: Record<string, unknown>) {
            return { received: inputs, limit: Object.hasOwn(inputs, "limit") ? inputs.limit : 7 };
          },
        } as never);
        const executor = Executor.fromRegistry(registry);
        const factory = new MCPServerFactory();
        const tool = factory.buildTools(registry)[0];
        const expected = Object.keys(schema).length ? { ...schema, type: "object" } : { type: "object", properties: {} };
        expect(tool.inputSchema).toEqual(expected);
        const descriptor = registry.getDefinition("demo.echo")!;
        for (const strict of [false, true]) {
          expect(factory.buildTool(descriptor, { registry, strict }).inputSchema).toEqual(expected);
        }
        const detached = factory.buildTool(descriptor);
        const registeredSchema = structuredClone(descriptor.inputSchema);
        const properties = detached.inputSchema.properties as Record<string, Record<string, unknown>> | undefined;
        const firstProperty = Object.values(properties ?? {})[0];
        if (firstProperty) firstProperty.description = "Changed on the advertised copy";
        detached.inputSchema.properties = { changed: { type: "string" } };
        expect(registry.getDefinition("demo.echo")!.inputSchema).toEqual(registeredSchema);
        const router = new ExecutionRouter(executor as never, { validateInputs });
        const validate = new Ajv({ strict: false, validateFormats: false }).compile(tool.inputSchema);
        for (const sample of c.samples) {
          const args = structuredClone(sample.arguments);
          expect(validate(args), sample.id).toBe(sample.valid);
          expect((await executor.validate("demo.echo", args)).valid, sample.id).toBe(sample.valid);
          let expectedOutput: unknown;
          if (sample.valid) {
            expectedOutput = await executor.call("demo.echo", structuredClone(args));
          } else {
            await expect(executor.call("demo.echo", structuredClone(args))).rejects.toThrow();
          }
          const [content, isError] = await router.handleCall("demo.echo", args);
          expect(isError, `${sample.id}: ${JSON.stringify(content)}`).toBe(!sample.valid);
          if (sample.valid) {
            const actual = JSON.parse(content[0].text);
            expect(actual).toEqual(expectedOutput);
            expect(actual.received).toEqual(sample.arguments);
            if (Object.hasOwn(args, "limit")) expect(actual.limit).toEqual(args.limit);
          }
          expect(args).toEqual(sample.arguments);
        }
        expect(schema).toEqual(c.input_schema);
      });
    }
  }
});

it.each([[], ["invalid"], true, 42])("rejects malformed schema %j", schema => {
  expect(() => new MCPServerFactory().buildTool({
    moduleId: "demo.echo", description: "Malformed schema", inputSchema: schema,
    outputSchema: {}, annotations: null,
  } as never)).toThrow("MCP input schema must be an object");
});
