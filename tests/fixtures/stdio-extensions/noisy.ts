console.log("extension import diagnostic");
export default {
  description: "Noisy CLI discovery fixture",
  inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object" },
  execute() { console.log("CLI tool diagnostic"); return { ok: true }; },
};
