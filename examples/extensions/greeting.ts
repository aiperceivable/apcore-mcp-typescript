/**
 * Generate a personalized greeting message.
 */

import { Type } from "@sinclair/typebox";

const inputSchema = Type.Object({
  name: Type.String({ description: "Name of the person to greet" }),
  style: Type.String({ default: "friendly", description: "Greeting style: friendly, formal, pirate" }),
});

const outputSchema = Type.Object({
  message: Type.String({ description: "The greeting message" }),
  timestamp: Type.String({ description: "ISO 8601 timestamp" }),
});

const STYLES: Record<string, string> = {
  friendly: "Hey {name}! Great to see you!",
  formal: "Good day, {name}. It is a pleasure to make your acquaintance.",
  pirate: "Ahoy, {name}! Welcome aboard, matey!",
};

export default {
  inputSchema,
  outputSchema,
  description: "Generate a personalized greeting in different styles",
  tags: ["text", "fun"],
  annotations: { readonly: true, idempotent: false, openWorld: false },

  execute(inputs: Record<string, unknown>): Record<string, unknown> {
    const name = inputs.name as string;
    const style = (inputs.style as string) || "friendly";
    const template = STYLES[style];
    if (!template) {
      throw new Error(`Unknown greeting style: ${style}. Use: friendly, formal, pirate`);
    }
    return {
      message: template.replace("{name}", name),
      timestamp: new Date().toISOString(),
    };
  },
};
