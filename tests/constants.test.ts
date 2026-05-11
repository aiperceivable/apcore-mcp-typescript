/**
 * Tests for the centralized constants barrel (src/constants.ts).
 *
 * [D8-005] Structural-parity sanity checks — guard against re-exports
 * drifting from the canonical sources in src/types.ts / src/config.ts /
 * src/helpers.ts, and against the new bridge-level defaults diverging
 * from MCP_DEFAULTS / serve() fallbacks.
 */

import { describe, it, expect } from "vitest";

import * as constants from "../src/constants.js";
import { ErrorCodes, REGISTRY_EVENTS, APCORE_EVENTS, MODULE_ID_PATTERN } from "../src/types.js";
import { MCP_NAMESPACE, MCP_ENV_PREFIX, MCP_DEFAULTS } from "../src/config.js";
import { MCP_PROGRESS_KEY, MCP_ELICIT_KEY } from "../src/helpers.js";

describe("constants barrel [D8-005]", () => {
  it("re-exports the framework error codes verbatim", () => {
    expect(constants.ErrorCodes).toBe(ErrorCodes);
    expect(constants.ErrorCodes.MODULE_NOT_FOUND).toBe("MODULE_NOT_FOUND");
    expect(constants.ErrorCodes.GENERAL_INTERNAL_ERROR).toBe(
      "GENERAL_INTERNAL_ERROR",
    );
  });

  it("re-exports registry event names verbatim", () => {
    expect(constants.REGISTRY_EVENTS).toBe(REGISTRY_EVENTS);
    expect(constants.REGISTRY_EVENTS.REGISTER).toBe("register");
    expect(constants.REGISTRY_EVENTS.UNREGISTER).toBe("unregister");
  });

  it("re-exports APCORE_EVENTS verbatim", () => {
    expect(constants.APCORE_EVENTS).toBe(APCORE_EVENTS);
    expect(constants.APCORE_EVENTS.MODULE_TOGGLED).toBe("apcore.module.toggled");
  });

  it("re-exports MODULE_ID_PATTERN verbatim", () => {
    expect(constants.MODULE_ID_PATTERN).toBe(MODULE_ID_PATTERN);
    expect(constants.MODULE_ID_PATTERN.test("image.resize")).toBe(true);
    expect(constants.MODULE_ID_PATTERN.test("Image.Resize")).toBe(false);
  });

  it("re-exports MCP namespace and defaults verbatim", () => {
    expect(constants.MCP_NAMESPACE).toBe(MCP_NAMESPACE);
    expect(constants.MCP_ENV_PREFIX).toBe(MCP_ENV_PREFIX);
    expect(constants.MCP_DEFAULTS).toBe(MCP_DEFAULTS);
  });

  it("re-exports progress / elicit context keys verbatim", () => {
    expect(constants.MCP_PROGRESS_KEY).toBe(MCP_PROGRESS_KEY);
    expect(constants.MCP_ELICIT_KEY).toBe(MCP_ELICIT_KEY);
  });

  it("transport-name constants match the strings accepted by serve()", () => {
    expect(constants.TRANSPORTS.STDIO).toBe("stdio");
    expect(constants.TRANSPORTS.STREAMABLE_HTTP).toBe("streamable-http");
    expect(constants.TRANSPORTS.SSE).toBe("sse");
  });

  it("server defaults stay in lock-step with MCP_DEFAULTS", () => {
    expect(constants.DEFAULT_HOST).toBe(MCP_DEFAULTS.host);
    expect(constants.DEFAULT_PORT).toBe(MCP_DEFAULTS.port);
    expect(constants.DEFAULT_SERVER_NAME).toBe(MCP_DEFAULTS.name);
    expect(constants.DEFAULT_EXPLORER_PREFIX).toBe(MCP_DEFAULTS.explorer_prefix);
  });
});
