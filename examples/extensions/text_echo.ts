/**
 * Echo text back — a minimal read-only module for testing.
 */

import { Type } from "@sinclair/typebox";

const inputSchema = Type.Object({
  text: Type.String({ description: "Text to echo back" }),
  uppercase: Type.Boolean({ default: false, description: "Convert to uppercase" }),
});

const outputSchema = Type.Object({
  echoed: Type.String({ description: "The echoed text" }),
  length: Type.Integer({ description: "Character count" }),
});

export default {
  inputSchema,
  outputSchema,
  description: "Echo input text back, optionally converting to uppercase",
  tags: ["text", "utility"],
  annotations: { readonly: true, idempotent: true, openWorld: false },

  execute(inputs: Record<string, unknown>): Record<string, unknown> {
    let text = inputs.text as string;
    if (inputs.uppercase) {
      text = text.toUpperCase();
    }
    return { echoed: text, length: text.length };
  },
};
