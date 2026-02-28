import { describe, it, expect } from "vitest";
import { createBridgeContext } from "../../src/server/context.js";
import { createIdentity } from "apcore-js";

describe("createBridgeContext", () => {
  it("has all required fields", () => {
    const data = { foo: "bar" };
    const ctx = createBridgeContext(data);

    expect(ctx.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ctx.callerId).toBeNull();
    expect(ctx.callChain).toEqual([]);
    expect(ctx.executor).toBeNull();
    expect(ctx.identity).toBeNull();
    expect(ctx.redactedInputs).toBeNull();
    expect(ctx.data).toBe(data);
    expect(typeof ctx.child).toBe("function");
  });

  it("child() returns new context with shared data reference", () => {
    const data = { key: "value" };
    const parent = createBridgeContext(data);
    const child = parent.child("mod.a");

    // Different object
    expect(child).not.toBe(parent);

    // Same data reference
    expect(child.data).toBe(parent.data);

    // Mutating data is visible in both
    child.data["added"] = true;
    expect(parent.data["added"]).toBe(true);
  });

  it("child() updates callChain and callerId correctly", () => {
    const parent = createBridgeContext({});
    const child1 = parent.child("mod.a");
    const child2 = child1.child("mod.b");

    // callerId = last element of parent's callChain (who called me)
    expect(child1.callerId).toBeNull(); // parent has empty callChain
    expect(child1.callChain).toEqual(["mod.a"]);

    expect(child2.callerId).toBe("mod.a"); // child1's callChain = ["mod.a"]
    expect(child2.callChain).toEqual(["mod.a", "mod.b"]);
  });

  it("child() preserves traceId from parent", () => {
    const parent = createBridgeContext({});
    const child = parent.child("mod.a");
    const grandchild = child.child("mod.b");

    expect(child.traceId).toBe(parent.traceId);
    expect(grandchild.traceId).toBe(parent.traceId);
  });

  it("child() does not mutate parent's callChain", () => {
    const parent = createBridgeContext({});
    const child = parent.child("mod.a");

    expect(parent.callChain).toEqual([]);
    expect(child.callChain).toEqual(["mod.a"]);

    child.child("mod.b");
    expect(child.callChain).toEqual(["mod.a"]);
  });

  it("accepts identity parameter", () => {
    const identity = createIdentity("user-1", "admin", ["editor"]);
    const ctx = createBridgeContext({}, identity);

    expect(ctx.identity).toBe(identity);
    expect(ctx.identity!.id).toBe("user-1");
    expect(ctx.identity!.type).toBe("admin");
    expect(ctx.identity!.roles).toEqual(["editor"]);
  });

  it("identity defaults to null when not provided", () => {
    const ctx = createBridgeContext({});
    expect(ctx.identity).toBeNull();
  });

  it("child() propagates identity to children", () => {
    const identity = createIdentity("user-2", "service");
    const parent = createBridgeContext({}, identity);
    const child = parent.child("mod.a");
    const grandchild = child.child("mod.b");

    expect(child.identity).toBe(identity);
    expect(grandchild.identity).toBe(identity);
  });
});
