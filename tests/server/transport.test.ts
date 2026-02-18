/**
 * Tests for TransportManager validation logic and HTTP transports.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { TransportManager } from "../../src/server/transport.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AddressInfo } from "node:net";

describe("TransportManager", () => {
  const manager = new TransportManager();

  describe("_validateHostPort", () => {
    it("accepts valid host and port", () => {
      expect(() => manager._validateHostPort("127.0.0.1", 8000)).not.toThrow();
    });

    it("accepts port 1 (minimum)", () => {
      expect(() => manager._validateHostPort("localhost", 1)).not.toThrow();
    });

    it("accepts port 65535 (maximum)", () => {
      expect(() =>
        manager._validateHostPort("localhost", 65535),
      ).not.toThrow();
    });

    it("rejects empty host", () => {
      expect(() => manager._validateHostPort("", 8000)).toThrow(
        "Host must be a non-empty string",
      );
    });

    it("rejects port 0", () => {
      expect(() => manager._validateHostPort("localhost", 0)).toThrow(
        "Port must be an integer between 1 and 65535",
      );
    });

    it("rejects port above 65535", () => {
      expect(() => manager._validateHostPort("localhost", 65536)).toThrow(
        "Port must be an integer between 1 and 65535",
      );
    });

    it("rejects negative port", () => {
      expect(() => manager._validateHostPort("localhost", -1)).toThrow(
        "Port must be an integer between 1 and 65535",
      );
    });

    it("rejects non-integer port", () => {
      expect(() => manager._validateHostPort("localhost", 8000.5)).toThrow(
        "Port must be an integer between 1 and 65535",
      );
    });
  });

  describe("runStreamableHttp", () => {
    let mgr: TransportManager;

    afterEach(async () => {
      if (mgr) await mgr.close();
    });

    it("connects transport to server and starts HTTP listener", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runStreamableHttp(mockServer, {
        host: "127.0.0.1",
        port: 0,
      });

      expect(mockServer.connect).toHaveBeenCalledOnce();
      expect(mgr.httpServer).toBeDefined();
      expect(mgr.httpServer!.listening).toBe(true);
    });

    it("returns 404 for non-endpoint paths", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runStreamableHttp(mockServer, {
        host: "127.0.0.1",
        port: 0,
      });

      const addr = mgr.httpServer!.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${addr.port}/nonexistent`);
      expect(res.status).toBe(404);
    });

    it("routes POST to /mcp endpoint to transport", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runStreamableHttp(mockServer, {
        host: "127.0.0.1",
        port: 0,
      });

      const addr = mgr.httpServer!.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          id: 1,
        }),
      });
      // Should reach transport (not our 404)
      expect(res.status).not.toBe(404);
    });

    it("uses custom endpoint when specified", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runStreamableHttp(mockServer, {
        host: "127.0.0.1",
        port: 0,
        endpoint: "/custom",
      });

      const addr = mgr.httpServer!.address() as AddressInfo;
      // Default /mcp should return 404
      const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`);
      expect(res.status).toBe(404);
    });

    it("returns 413 when request body exceeds size limit", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runStreamableHttp(mockServer, {
        host: "127.0.0.1",
        port: 0,
      });

      const addr = mgr.httpServer!.address() as AddressInfo;
      // 5MB body exceeds the 4MB default limit
      const largeBody = "x".repeat(5 * 1024 * 1024);
      const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: largeBody,
      });
      expect(res.status).toBe(413);
    });
  });

  describe("runSse", () => {
    let mgr: TransportManager;

    afterEach(async () => {
      if (mgr) await mgr.close();
    });

    it("starts HTTP server and listens", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runSse(mockServer, { host: "127.0.0.1", port: 0 });

      expect(mgr.httpServer).toBeDefined();
      expect(mgr.httpServer!.listening).toBe(true);
    });

    it("returns 404 for non-endpoint paths", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runSse(mockServer, { host: "127.0.0.1", port: 0 });

      const addr = mgr.httpServer!.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${addr.port}/nonexistent`);
      expect(res.status).toBe(404);
    });

    it("POST to /messages without session returns 400", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runSse(mockServer, { host: "127.0.0.1", port: 0 });

      const addr = mgr.httpServer!.address() as AddressInfo;
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "test", id: 1 }),
        },
      );
      expect(res.status).toBe(400);
    });

    it("uses custom endpoint when specified", async () => {
      mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runSse(mockServer, {
        host: "127.0.0.1",
        port: 0,
        endpoint: "/events",
      });

      const addr = mgr.httpServer!.address() as AddressInfo;
      // Default /sse should 404
      const res = await fetch(`http://127.0.0.1:${addr.port}/sse`);
      expect(res.status).toBe(404);
    });
  });

  describe("close", () => {
    it("closes the HTTP server", async () => {
      const mgr = new TransportManager();
      vi.spyOn(mgr, "_validateHostPort").mockImplementation(() => {});
      const mockServer = {
        connect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Server;

      await mgr.runStreamableHttp(mockServer, {
        host: "127.0.0.1",
        port: 0,
      });
      expect(mgr.httpServer!.listening).toBe(true);

      await mgr.close();
      expect(mgr.httpServer!.listening).toBe(false);
    });

    it("is safe to call when no server is running", async () => {
      const mgr = new TransportManager();
      await expect(mgr.close()).resolves.toBeUndefined();
    });
  });
});
