import { describe, it, expect, vi } from "vitest";
import {
  reportProgress,
  elicit,
  MCP_PROGRESS_KEY,
  MCP_ELICIT_KEY,
} from "../src/helpers.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reportProgress", () => {
  it("calls the _mcp_progress callback with correct args", async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    const context = { data: { [MCP_PROGRESS_KEY]: callback } };

    await reportProgress(context, 5, 10, "halfway there");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(5, 10, "halfway there");
  });

  it("calls callback with only progress when total/message omitted", async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    const context = { data: { [MCP_PROGRESS_KEY]: callback } };

    await reportProgress(context, 3);

    expect(callback).toHaveBeenCalledWith(3, undefined, undefined);
  });

  it("no-ops when callback is absent", async () => {
    const context = { data: {} };

    // Should not throw
    await reportProgress(context, 1, 10, "test");
  });
});

describe("elicit", () => {
  it("calls the _mcp_elicit callback and returns result", async () => {
    const result = { action: "accept" as const, content: { confirmed: true } };
    const callback = vi.fn().mockResolvedValue(result);
    const context = { data: { [MCP_ELICIT_KEY]: callback } };

    const response = await elicit(context, "Continue?", { type: "object" });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("Continue?", { type: "object" });
    expect(response).toEqual(result);
  });

  it("calls callback without schema when omitted", async () => {
    const result = { action: "decline" as const };
    const callback = vi.fn().mockResolvedValue(result);
    const context = { data: { [MCP_ELICIT_KEY]: callback } };

    const response = await elicit(context, "Are you sure?");

    expect(callback).toHaveBeenCalledWith("Are you sure?", undefined);
    expect(response).toEqual(result);
  });

  it("returns null when callback is absent", async () => {
    const context = { data: {} };

    const response = await elicit(context, "Hello?");

    expect(response).toBeNull();
  });
});
