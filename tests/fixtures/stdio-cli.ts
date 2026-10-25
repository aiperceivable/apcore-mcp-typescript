import { Config, Registry } from "apcore-js";
// Instrument configuration construction without replacing the real SDK Config.
Object.defineProperty(Config, "getInstance", { value: () => {
  console.log("config bootstrap diagnostic");
  return new Config();
} });
const discover = Registry.prototype.discover;
Registry.prototype.discover = function (...args: Parameters<typeof discover>) {
  console.log("discovery bootstrap diagnostic");
  return discover.apply(this, args);
};
process.argv = [process.argv[0], "apcore-mcp", "--extensions-dir", "tests/fixtures/stdio-extensions", "--no-async"];
const { main } = await import("../../src/cli.js");
await main();
