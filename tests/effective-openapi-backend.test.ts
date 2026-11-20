import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Registry } from "apcore-js";
import { expect, it } from "vitest";
import { openapiBackend } from "../src/openapi-backend.js";

const response = { "200": { description: "OK" } };
const document = {
  openapi: "3.1.0",
  info: { title: "Inventory", version: "1" },
  components: {
    parameters: {
      ItemId: { in: "path", name: "item_id", required: true, schema: { type: "string" } },
      Tag: { in: "query", name: "tag", schema: { type: "array", items: { type: "string" } } },
    },
  },
  paths: {
    "/items/{item_id}": {
      parameters: [{ $ref: "#/components/parameters/ItemId" }, { $ref: "#/components/parameters/Tag" }],
      get: { operationId: "list_items", summary: "List items", responses: response },
    },
    "/updates": {
      parameters: [{ $ref: "#/components/parameters/Tag" }],
      post: { operationId: "update_items", summary: "Update items", responses: response },
    },
  },
};

it("rejects selected proxy hazards before mutating the registry", async () => {
  const registry = new Registry();
  await expect(openapiBackend(document, { registry, baseUrl: "http://127.0.0.1:1" }))
    .rejects.toThrow(/OpenAPI proxy cannot forward selected operations:.*update_items.*tag/s);
  expect(registry.list()).toEqual([]);
});

it("forwards inherited referenced values after filtering an unsupported operation", async () => {
  const requests: URL[] = [];
  const server = createServer((request, response) => {
    requests.push(new URL(request.url ?? "/", "http://127.0.0.1"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const registry = await openapiBackend(document, {
      include: "^list_items$",
      baseUrl: `http://127.0.0.1:${port}`,
    });
    expect(registry.list()).toEqual(["list_items"]);
    const module = registry.get("list_items");
    if (module === undefined) throw new Error("Expected list_items");
    await module.execute({ item_id: "A/B", tag: ["red", "blue"] }, {} as Parameters<typeof module.execute>[1]);
    expect(requests.map(url => url.pathname)).toEqual(["/items/A%2FB"]);
    expect(requests[0].searchParams.getAll("tag")).toEqual(["red", "blue"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => {
      if (error) reject(error);
      else resolve();
    }));
  }
});
