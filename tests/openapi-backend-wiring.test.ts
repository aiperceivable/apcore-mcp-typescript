/**
 * Wiring regressions for the OpenAPI backend.
 *
 * The conformance suite (`openapi-backend-conformance.test.ts`) hands
 * `openapiBackend` an already-parsed document and calls `resolveSpecLocation`
 * directly with an explicit `projectRoot`. That covers the pure functions and
 * misses everything between them — which is where two shipped defects lived:
 *
 *   - `timeout` is seconds on this bridge and milliseconds on `loadSpec`, so
 *     passing it straight through turned the documented 30 s default into a
 *     30 ms fetch budget (apcore-mcp-typescript#10).
 *   - `Config.projectRoot` was never read, so a relative `spec` resolved
 *     against the process CWD on every route (apcore-mcp#19).
 *
 * Both require a real fetch and a real resolution, so these tests run a local
 * HTTP server and a temporary project root rather than asserting on options.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({ projectRoot: undefined as string | undefined }));

vi.mock("apcore-js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Config = { getInstance: () => ({ projectRoot: state.projectRoot }) };
  return {
    ...actual,
    Config,
    default: { ...((actual.default as object) ?? {}), Config },
  };
});

const { openapiBackend, buildOpenapiBackendFromConfig } = await import(
  "../src/openapi-backend.js"
);

const DOCUMENT = {
  openapi: "3.0.0",
  info: { title: "Petstore", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

/** Delay before the spec body is written, in milliseconds. */
const SERVE_DELAY_MS = 120;

let server: Server;
let specUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(DOCUMENT));
    }, SERVE_DELAY_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  specUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openapi.json`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.projectRoot = undefined;
});

describe("#10: mcp.openapi.timeout is seconds, loadSpec takes milliseconds", () => {
  it("the documented default fetches a spec that answers after 120ms", async () => {
    // Straight-through, the Config Bus default of 30 is a 30 ms budget and
    // this server (120 ms) never answers in time.
    const registry = await buildOpenapiBackendFromConfig({
      spec: specUrl,
      base_url: "https://api.example.com",
    });
    expect(registry).not.toBeNull();
    expect(registry!.list()).toContain("listpets");
  });

  it("an explicit timeout is honoured in seconds, not milliseconds", async () => {
    const registry = await openapiBackend(specUrl, {
      baseUrl: "https://api.example.com",
      timeout: 5,
    });
    expect(registry.list()).toContain("listpets");
  });

  it("a sub-fetch-duration timeout still aborts, so the value is not ignored", async () => {
    // 0.01 s = 10 ms < the server's 120 ms. Proves the conversion multiplies
    // rather than the option being dropped on the floor.
    await expect(
      openapiBackend(specUrl, { baseUrl: "https://api.example.com", timeout: 0.01 }),
    ).rejects.toThrow(/failed/i);
  });
});

describe("#19: a relative spec resolves against Config.projectRoot", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-mcp-openapi-"));
    fs.writeFileSync(path.join(projectDir, "openapi.json"), JSON.stringify(DOCUMENT));
    state.projectRoot = projectDir;
  });

  it("reads Config.projectRoot on the Config Bus route", async () => {
    // The file exists ONLY under projectDir; process.cwd() is the package
    // root, so resolving against the CWD raises ENOENT.
    expect(projectDir).not.toBe(process.cwd());
    const registry = await buildOpenapiBackendFromConfig({
      spec: "./openapi.json",
      base_url: "https://api.example.com",
    });
    expect(registry).not.toBeNull();
    expect(registry!.list()).toContain("listpets");
  });

  it("reads Config.projectRoot on a direct call with no explicit projectRoot", async () => {
    const registry = await openapiBackend("./openapi.json", {
      baseUrl: "https://api.example.com",
    });
    expect(registry.list()).toContain("listpets");
  });

  it("an explicit projectRoot still wins over Config", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "apcore-mcp-openapi-other-"));
    fs.writeFileSync(path.join(other, "openapi.json"), JSON.stringify(DOCUMENT));
    state.projectRoot = "/nonexistent-project-root";
    const registry = await openapiBackend("./openapi.json", {
      baseUrl: "https://api.example.com",
      projectRoot: other,
    });
    expect(registry.list()).toContain("listpets");
  });

  it("falls back to the CWD when Config carries no project root", async () => {
    state.projectRoot = undefined;
    await expect(
      openapiBackend("./definitely-not-here.json", { baseUrl: "https://api.example.com" }),
    ).rejects.toThrow(/failed to read/i);
  });
});
