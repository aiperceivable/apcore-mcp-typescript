/**
 * Basic arithmetic calculator module.
 */

import { Type } from "@sinclair/typebox";
import { DEFAULT_ANNOTATIONS, type ModuleAnnotations, type Context } from "apcore-js";

const inputSchema = Type.Object({
  a: Type.Number({ description: "First operand" }),
  b: Type.Number({ description: "Second operand" }),
  op: Type.String({ default: "add", description: "Operation: add, sub, mul, div" }),
});

const outputSchema = Type.Object({
  result: Type.Number({ description: "Calculation result" }),
  expression: Type.String({ description: "Human-readable expression" }),
});

const annotations: ModuleAnnotations = {
  ...DEFAULT_ANNOTATIONS,
  readonly: true,
  idempotent: true,
  openWorld: false,
};

const OPS: Record<string, [string, (a: number, b: number) => number]> = {
  add: ["+", (a, b) => a + b],
  sub: ["-", (a, b) => a - b],
  mul: ["*", (a, b) => a * b],
  div: ["/", (a, b) => a / b],
};

export default {
  inputSchema,
  outputSchema,
  description: "Perform basic arithmetic: add, subtract, multiply, or divide",
  tags: ["math", "utility"],
  annotations,

  execute(inputs: Record<string, unknown>, _context: Context): Record<string, unknown> {
    const a = inputs.a as number;
    const b = inputs.b as number;
    const op = (inputs.op as string) || "add";

    const entry = OPS[op];
    if (!entry) {
      throw new Error(`Unknown operation: '${op}'. Expected: add, sub, mul, div`);
    }
    if (op === "div" && b === 0) {
      throw new Error("Division by zero");
    }

    const [symbol, fn] = entry;
    const result = fn(a, b);
    return { result, expression: `${a} ${symbol} ${b} = ${result}` };
  },
};
