/**
 * Module-ID handling in the OpenAPI backend since apcore-toolkit 0.13.0.
 *
 * The toolkit now normalises every `moduleId` it emits into apcore's Canonical
 * ID alphabet — after `basePathPrefix` and both ID-affecting hooks — so the
 * bridge registers the scanner's IDs as emitted and keeps only its skip
 * policy, applied to the ID `scan` returns. The shared fixture
 * (`openapi_backend.json`) pins the hook-free cases in all three languages;
 * these tests cover what needs a caller hook, which the Rust backend does not
 * expose.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Registry, FunctionModule } from "apcore-js";
import type { ScannedModule } from "apcore-toolkit";
import { openapiBackend, projectModuleId } from "../src/openapi-backend.js";

const OK = { responses: { "200": { description: "ok" } } };

const DOCUMENT: Record<string, unknown> = {
  openapi: "3.0.3",
  info: { title: "Petstore", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/pets": { get: { operationId: "listPets", ...OK } },
    "/pets/{petId}": { get: OK },
  },
};

function collector() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    skips: () => warnings.filter((w) => w.includes("OpenAPI operation skipped")),
    logger: { warn: (m: string) => warnings.push(m), error: (m: string) => errors.push(m) },
  };
}

function ids(registry: any): string[] {
  return ((registry.list({ visibility: ["public", "hidden"] }) as string[]) ?? []).sort();
}

describe("openapiBackend module IDs (apcore-toolkit >= 0.13.0)", () => {
  it("registers the IDs the scanner emits", async () => {
    // The bridge's old projection gave `listpets` and `pets.petid.get`.
    const { logger } = collector();
    expect(ids(await openapiBackend(DOCUMENT, { logger }))).toEqual([
      "list_pets",
      "pets.pet_id.get",
    ]);
  });

  it("normalises a hook-returned camelCase ID instead of skipping it", async () => {
    // A skip check inside transformModule would see `MyThing` and drop it.
    const c = collector();
    const registry = await openapiBackend(DOCUMENT, {
      logger: c.logger,
      transformModule: (m: ScannedModule) =>
        m.moduleId === "list_pets" ? { ...m, moduleId: "MyThing" } : m,
    });
    expect(ids(registry)).toEqual(["my_thing", "pets.pet_id.get"]);
    expect(c.skips()).toEqual([]);
  });

  it("still runs the caller's transformModule, which may drop a module", async () => {
    const c = collector();
    const seen: string[] = [];
    const registry = await openapiBackend(DOCUMENT, {
      logger: c.logger,
      transformModule: (m: ScannedModule) => {
        seen.push(m.moduleId);
        return m.moduleId === "pets.pet_id.get" ? null : m;
      },
    });
    expect(seen).toEqual(["list_pets", "pets.pet_id.get"]);
    expect(ids(registry)).toEqual(["list_pets"]);
    expect(c.skips(), "a module the caller's hook dropped is not the bridge's skip").toEqual([]);
  });

  it("skips an ID normalisation cannot repair, naming the emitted ID", async () => {
    // The hook returns `Pets.2Fa`; the toolkit emits `pets.2_fa`.
    const c = collector();
    const registry = await openapiBackend(DOCUMENT, {
      logger: c.logger,
      deriveModuleId: (p: string) => (p === "/pets" ? "Pets.2Fa" : null),
    });
    expect(ids(registry)).toEqual(["pets.pet_id.get"]);
    const skips = c.skips();
    expect(skips).toHaveLength(1);
    expect(skips[0]).toContain("'pets.2_fa'");
    expect(skips[0]).toContain("'2_fa'");
    expect(skips[0]).not.toContain("Pets.2Fa");
    expect(c.errors, "a skipped module must not reach the writer").toEqual([]);
  });

  it("skips an empty ID produced by a hook", async () => {
    const c = collector();
    const registry = await openapiBackend(DOCUMENT, {
      logger: c.logger,
      // `-` normalises to the empty ID, which only a hook can produce.
      transformModule: (m: ScannedModule) => (m.moduleId === "list_pets" ? { ...m, moduleId: "-" } : m),
    });
    expect(ids(registry)).toEqual(["pets.pet_id.get"]);
    const skips = c.skips();
    expect(skips).toHaveLength(1);
    expect(skips[0]).toContain("module ID ''");
  });

  it("leaves a skipped module out of the collision preflight", async () => {
    const registry = new Registry();
    await (registry as any).register(
      "keep",
      new FunctionModule({
        moduleId: "keep",
        description: "stub",
        handler: async () => ({}),
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      }),
    );
    const document = {
      ...DOCUMENT,
      paths: { "/v1/2fa": { post: OK }, "/pets": { get: { operationId: "listPets", ...OK } } },
    };
    const { logger } = collector();
    await openapiBackend(document, { registry, logger, acknowledgeUnapprovedWrites: true });
    expect(ids(registry)).toEqual(["keep", "list_pets"]);
  });
});

describe("projectModuleId (deprecated)", () => {
  it("keeps its behaviour unchanged", () => {
    expect(projectModuleId("listPets")).toBe("listpets");
    expect(projectModuleId("pet-store.items.get")).toBe("pet_store.items.get");
    expect(projectModuleId("v1.2fa.post")).toBeNull();
    expect(projectModuleId("")).toBeNull();
  });

  it("is called by nothing in src/", () => {
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          fs.readFileSync(full, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (/\bprojectModuleId\(/.test(line) && !/export function projectModuleId\(/.test(line)) {
                callers.push(`${path.relative(srcDir, full)}:${i + 1}`);
              }
            });
        }
      }
    };
    walk(srcDir);
    expect(callers).toEqual([]);
  });
});
