#!/usr/bin/env node

/**
 * CLI entry point: npx apcore-mcp
 *
 * Usage:
 *   apcore-mcp --extensions-dir ./extensions
 *   apcore-mcp --extensions-dir ./extensions --transport streamable-http --port 8000
 *   apcore-mcp --extensions-dir ./extensions --transport sse --port 8000
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { serve, VERSION } from "./index.js";

function printUsage(): void {
  console.log(`
apcore-mcp v${VERSION} - Automatic MCP Server for apcore modules

Usage:
  apcore-mcp --extensions-dir <path> [options]

Required:
  --extensions-dir <path>    Path to apcore extensions directory

Options:
  --transport <type>         Transport type: stdio, streamable-http, sse (default: stdio)
  --host <address>           Host for HTTP transports (default: 127.0.0.1)
  --port <number>            Port for HTTP transports (default: 8000, range: 1-65535)
  --name <string>            MCP server name (default: apcore-mcp, max 255 chars)
  --version <string>         MCP server version (default: package version)
  --log-level <level>        Logging level: DEBUG, INFO, WARNING, ERROR (default: INFO)
  --help                     Show this help message
`);
}

function fail(message: string, exitCode: number = 1): never {
  console.error(`Error: ${message}`);
  process.exit(exitCode);
}

export async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "extensions-dir": { type: "string" },
        transport: { type: "string", default: "stdio" },
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "string", default: "8000" },
        name: { type: "string", default: "apcore-mcp" },
        version: { type: "string" },
        "log-level": { type: "string", default: "INFO" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch {
    printUsage();
    process.exit(2);
  }

  const { values } = parsed;

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  // Validate --extensions-dir
  const extensionsDir = values["extensions-dir"];
  if (!extensionsDir) {
    fail("--extensions-dir is required.");
  }

  const resolvedDir = resolve(extensionsDir);
  if (!existsSync(resolvedDir)) {
    fail(`--extensions-dir '${extensionsDir}' does not exist.`);
  }
  if (!statSync(resolvedDir).isDirectory()) {
    fail(`--extensions-dir '${extensionsDir}' is not a directory.`);
  }

  // Validate transport
  const transport = values.transport as string;
  const validTransports = ["stdio", "streamable-http", "sse"];
  if (!validTransports.includes(transport)) {
    fail(
      `--transport must be one of: ${validTransports.join(", ")}. Got '${transport}'.`,
    );
  }

  // Validate port
  const port = parseInt(values.port as string, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    fail(`--port must be in range 1-65535, got '${values.port}'.`);
  }

  // Validate name length
  const name = values.name as string;
  if (name.length > 255) {
    fail(`--name must be at most 255 characters, got ${name.length}.`);
  }

  // Dynamic import of apcore Registry (peer dependency)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Registry: new (options: { extensionsDir: string }) => { discover(): Promise<number> };
  try {
    const apcore = await import("apcore-js");
    Registry = apcore.Registry;
  } catch {
    fail(
      "Failed to import 'apcore-js' package. Install it with: npm install apcore-js",
    );
  }

  // Create Registry and discover modules
  const registry = new Registry({ extensionsDir: resolvedDir });
  const numModules = await registry.discover();

  if (numModules === 0) {
    console.warn(`Warning: No modules discovered in '${extensionsDir}'.`);
  } else {
    console.info(`Discovered ${numModules} module(s) in '${extensionsDir}'.`);
  }

  // Validate log-level
  const logLevel = values["log-level"] as string | undefined;
  const validLogLevels = ["DEBUG", "INFO", "WARNING", "ERROR"];
  if (logLevel && !validLogLevels.includes(logLevel)) {
    fail(
      `--log-level must be one of: ${validLogLevels.join(", ")}. Got '${logLevel}'.`,
    );
  }

  // Launch the MCP server
  try {
    await serve(registry as never, {
      transport: transport as "stdio" | "streamable-http" | "sse",
      host: values.host as string,
      port,
      name,
      version: values.version ?? undefined,
      logLevel: logLevel as "DEBUG" | "INFO" | "WARNING" | "ERROR" | undefined,
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(2);
});
