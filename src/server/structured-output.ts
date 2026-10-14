/** Protocol-aware structured results over the governed router's JSON text. */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { InitializeRequestSchema, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import Ajv, { type ValidateFunction, type Options } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import Ajv2019 from "ajv/dist/2019.js";

const protocolVersions = new WeakMap<Server, string>();
const sessionProtocolServers = new WeakSet<Server>();
const schemaValidators = new WeakMap<object, { schemaText: string; validate: ValidateFunction }>();

const observedServers = new WeakSet<Server>();
const observedTransports = new WeakMap<Server, Transport>();

function observeTransport(server: Server, transport: Transport): void {
  if (observedTransports.get(server) === transport) return;
  observedTransports.set(server, transport);
  const initializationIds = new Set<string | number>();
  const previousMessage = transport.onmessage;
  const previousSend = transport.send.bind(transport);
  protocolVersions.delete(server);
  if (transport instanceof SSEServerTransport) sessionProtocolServers.add(server);
  else sessionProtocolServers.delete(server);
  transport.onmessage = (message, extra) => {
    if ("id" in message && message.id !== undefined && InitializeRequestSchema.safeParse(message).success) {
      initializationIds.add(message.id);
    }
    previousMessage?.(message, extra);
  };
  transport.send = async (message, options) => {
    if ("result" in message && initializationIds.delete(message.id)) {
      const version = message.result.protocolVersion;
      if (typeof version === "string") protocolVersions.set(server, version);
    }
    await previousSend(message, options);
  };
}

/** Observe public SDK transports, including caller-supplied servers. */
export function observeStructuredProtocol(server: Server): void {
  if (observedServers.has(server) || typeof server.connect !== "function") return;
  observedServers.add(server);
  const connect = server.connect.bind(server);
  server.connect = async (transport: Transport): Promise<void> => {
    // Preserve the active observer when the SDK rejects another connection.
    if (server.transport) {
      await connect(transport);
      return;
    }
    observeTransport(server, transport);
    await connect(transport);
  };
  if (server.transport) observeTransport(server, server.transport);
}

/** HTTP headers are authoritative per request; params metadata is never trusted. */
export function supportsStructuredOutput(
  server: Server,
  extra?: { requestInfo?: { headers: Record<string, string | string[] | undefined> } },
): boolean {
  const version = extra?.requestInfo && !sessionProtocolServers.has(server)
    ? extra.requestInfo.headers["mcp-protocol-version"] ?? "2025-03-26"
    : protocolVersions.get(server) ?? "2025-03-26";
  return typeof version === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(version) && version >= "2025-06-18";
}

function invalidStructuredOutput(): CallToolResult {
  return {
    content: [{ type: "text", text: "Tool output does not match its advertised output schema." }],
    isError: true,
  };
}

const SCHEMA_MAP_KEYS = ["$defs", "definitions", "properties", "patternProperties", "dependentSchemas", "dependencies"];
const SCHEMA_ARRAY_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems", "items"];
const SCHEMA_SINGLE_KEYS = ["items", "additionalItems", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames", "unevaluatedProperties", "unevaluatedItems"];

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type OutputSchemaDialect = "draft7" | "draft2019" | "draft2020";

function outputSchemaDialect(declaration: unknown): OutputSchemaDialect {
  if (declaration === undefined) return "draft2020";
  const identifier = typeof declaration === "string" ? declaration.replace(/#$/, "") : declaration;
  if (identifier === "http://json-schema.org/draft-07/schema") return "draft7";
  if (identifier === "https://json-schema.org/draft/2019-09/schema") return "draft2019";
  if (identifier === "https://json-schema.org/draft/2020-12/schema") return "draft2020";
  throw new Error("Unsupported output schema dialect.");
}

/** Visit actual schema positions, never opaque defaults, constants or examples. */
function schemaReferencePaths(root: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const dialect = outputSchemaDialect(root.$schema);
  const pending = [{ schema: root, path: "" }];
  const token = (value: string): string => encodeURIComponent(value.replace(/~/g, "~0").replace(/\//g, "~1"));
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const { schema, path } = current;
    if (schema.$schema !== undefined && outputSchemaDialect(schema.$schema) !== dialect) {
      throw new Error("Mixed output schema dialects are unsupported.");
    }
    const draft7 = dialect === "draft7";
    const draft2019 = dialect === "draft2019";
    const referenceKeys = draft7 ? ["$ref"] : ["$ref", draft2019 ? "$recursiveRef" : "$dynamicRef"];
    const mapKeys = draft7 ? ["definitions", "properties", "patternProperties", "dependencies"] : SCHEMA_MAP_KEYS.filter(key => key !== "definitions" && key !== "dependencies");
    const arrayKeys = draft7 || draft2019 ? SCHEMA_ARRAY_KEYS.filter(key => key !== "prefixItems") : SCHEMA_ARRAY_KEYS.filter(key => key !== "items");
    const singleKeys = SCHEMA_SINGLE_KEYS.filter(key => (draft7 || draft2019 || key !== "additionalItems") && (!draft7 || !key.startsWith("unevaluated")));
    if (referenceKeys.some(key => typeof schema[key] === "string")) paths.push(path);
    for (const key of singleKeys) {
      if (isSchemaObject(schema[key])) pending.push({ schema: schema[key], path: `${path}/${key}` });
    }
    for (const key of mapKeys) {
      const map = schema[key];
      if (isSchemaObject(map)) {
        for (const [name, child] of Object.entries(map)) {
          if (isSchemaObject(child)) pending.push({ schema: child, path: `${path}/${token(key)}/${token(name)}` });
        }
      }
    }
    for (const key of arrayKeys) {
      const array = schema[key];
      if (Array.isArray(array)) {
        for (const [index, child] of array.entries()) {
          if (isSchemaObject(child)) pending.push({ schema: child, path: `${path}/${key}/${index}` });
        }
      }
    }
  }
  return paths;
}

function validateOutputObject(schema: NonNullable<Tool["outputSchema"]>, value: object): boolean {
  const schemaText = JSON.stringify(schema);
  let cached = schemaValidators.get(schema);
  if (cached?.schemaText !== schemaText) {
    const options: Options = { logger: false, strict: false, strictNumbers: true, validateFormats: false,
      coerceTypes: false, removeAdditional: false, useDefaults: false };
    const referencePaths = schemaReferencePaths(schema);
    const dialect = outputSchemaDialect(schema.$schema);
    // Draft-07 ignores assertion siblings of $ref; 2020-12 applies them.
    const validator = dialect === "draft7" ? new Ajv({ ...options, ignoreKeywordsWithRef: true })
      : dialect === "draft2019" ? new Ajv2019(options) : new Ajv2020(options);
    const rootId = typeof schema.$id === "string" ? schema.$id : "urn:apcore-mcp:output-schema";
    const indexedSchema = schema.$id === undefined ? { ...schema, $id: rootId } : schema;
    const validate = validator.compile(indexedSchema);
    // Force compilation of unused reference-bearing schemas as well as active branches.
    for (const path of referencePaths) {
      validator.compile({ $ref: `${rootId.split("#")[0]}#${path}` });
    }
    cached = { schemaText, validate };
    schemaValidators.set(schema, cached);
  }
  return cached.validate(value) as boolean;
}

function hasFiniteJsonNumbers(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "number" && !Number.isFinite(current)) return false;
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else if (current !== null && typeof current === "object") {
      for (const item of Object.values(current)) pending.push(item);
    }
  }
  return true;
}

function normalizeJsonNumber(token: string): string {
  const [mantissa, exponent = "0"] = token.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const point = unsigned.indexOf(".");
  const fractionLength = point < 0 ? 0 : unsigned.length - point - 1;
  const coefficient = unsigned.replace(".", "").replace(/^0+/, "");
  if (!coefficient) return "0";
  const significant = coefficient.replace(/0+$/, "");
  const power = BigInt(exponent) - BigInt(fractionLength) + BigInt(coefficient.length - significant.length);
  return `${negative ? "-" : ""}${significant}e${power}`;
}

/** Compare numeric values without reading digits inside quoted JSON strings. */
function hasLosslessJsonNumbers(text: string): boolean {
  const tokens = /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('"')) continue;
    const encoded = JSON.stringify(Number(token));
    if (normalizeJsonNumber(token) !== normalizeJsonNumber(encoded)) return false;
  }
  return true;
}

/** Only already-redacted JSON objects can become structuredContent. */
export function addStructuredOutput(result: CallToolResult, tool?: Tool): CallToolResult {
  const { structuredContent: _previousStructuredContent, ...textResult } = result;
  if (result.isError) return textResult;
  const text = result.content[0]?.type === "text" ? result.content[0].text : undefined;
  let value: unknown;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
    // A valid parse can still exceed the transport JSON encoder's nesting limit.
    JSON.stringify(value);
    if (text !== undefined && (!hasFiniteJsonNumbers(value) || !hasLosslessJsonNumbers(text))) {
      return tool?.outputSchema ? invalidStructuredOutput() : textResult;
    }
  } catch {
    return tool?.outputSchema ? invalidStructuredOutput() : textResult;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return tool?.outputSchema ? invalidStructuredOutput() : textResult;
  }
  if (tool?.outputSchema) {
    try {
      if (!validateOutputObject(tool.outputSchema, value)) {
        return invalidStructuredOutput();
      }
    } catch {
      return invalidStructuredOutput();
    }
  }
  return { ...textResult, structuredContent: value as Record<string, unknown> };
}
