/**
 * Tests for identity storage (AsyncLocalStorage-based identity propagation).
 */

import { describe, it, expect } from "vitest";
import { identityStorage, getCurrentIdentity } from "../../src/auth/storage.js";
import { createIdentity } from "apcore-js";

describe("identityStorage", () => {
  it("getCurrentIdentity() returns null outside any scope", () => {
    expect(getCurrentIdentity()).toBeNull();
  });

  it("getCurrentIdentity() returns identity within scope", async () => {
    const identity = createIdentity("user-1", "admin", ["editor"]);

    await identityStorage.run(identity, async () => {
      expect(getCurrentIdentity()).toBe(identity);
      expect(getCurrentIdentity()!.id).toBe("user-1");
      expect(getCurrentIdentity()!.type).toBe("admin");
      expect(getCurrentIdentity()!.roles).toEqual(["editor"]);
    });
  });

  it("getCurrentIdentity() returns null after scope exits", async () => {
    const identity = createIdentity("user-2");

    await identityStorage.run(identity, async () => {
      expect(getCurrentIdentity()).toBe(identity);
    });

    expect(getCurrentIdentity()).toBeNull();
  });

  it("supports null identity in scope", async () => {
    await identityStorage.run(null, async () => {
      expect(getCurrentIdentity()).toBeNull();
    });
  });

  it("nested scopes use innermost identity", async () => {
    const outer = createIdentity("outer-user");
    const inner = createIdentity("inner-user");

    await identityStorage.run(outer, async () => {
      expect(getCurrentIdentity()!.id).toBe("outer-user");

      await identityStorage.run(inner, async () => {
        expect(getCurrentIdentity()!.id).toBe("inner-user");
      });

      // Back to outer
      expect(getCurrentIdentity()!.id).toBe("outer-user");
    });
  });

  it("identity propagates through async calls", async () => {
    const identity = createIdentity("async-user", "service");

    await identityStorage.run(identity, async () => {
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      expect(getCurrentIdentity()!.id).toBe("async-user");

      // Simulate nested async
      const result = await Promise.resolve().then(() => getCurrentIdentity());
      expect(result!.id).toBe("async-user");
    });
  });

  it("concurrent scopes are isolated", async () => {
    const user1 = createIdentity("user-1");
    const user2 = createIdentity("user-2");

    const results: string[] = [];

    await Promise.all([
      identityStorage.run(user1, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(getCurrentIdentity()!.id);
      }),
      identityStorage.run(user2, async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(getCurrentIdentity()!.id);
      }),
    ]);

    expect(results).toContain("user-1");
    expect(results).toContain("user-2");
  });

  it("identity is accessible in deeply nested function calls", async () => {
    const identity = createIdentity("deep-user");

    function level3() { return getCurrentIdentity(); }
    function level2() { return level3(); }
    function level1() { return level2(); }

    await identityStorage.run(identity, async () => {
      const result = level1();
      expect(result!.id).toBe("deep-user");
    });
  });
});
