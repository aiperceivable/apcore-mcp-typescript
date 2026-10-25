import { describe, expect, it, vi } from "vitest";
import { bindStdioWork, observeStdioWork, withStdioOutput } from "../../src/server/stdio-output.js";

describe("stdio output lease", () => {
  it("redirects stdout overloads to stderr and restores after a failed bootstrap", async () => {
    const stdout = process.stdout.write;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(((_chunk, encodingOrCallback, callback) => {
      const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
      done?.(); return false;
    }) as typeof process.stderr.write);
    const callback = vi.fn();
    try {
      await expect(withStdioOutput(async () => {
        expect(process.stdout.write("diagnostic", "utf8", callback)).toBe(false);
        throw new Error("failed setup");
      })).rejects.toThrow("failed setup");
      expect(callback).toHaveBeenCalledOnce();
      expect(stderr).toHaveBeenCalledWith("diagnostic", "utf8", callback);
      expect(process.stdout.write).toBe(stdout);
    } finally { stderr.mockRestore(); }
  });

  it("shares a nested lease, rejects concurrent owners/transport claims, permits sequential claims", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = withStdioOutput(async (lease) => {
      await withStdioOutput(async (nested) => { expect(nested).toBe(lease); });
      const unclaim = lease.claimTransport();
      expect(() => lease.claimTransport()).toThrow("already owns stdout");
      unclaim();
      lease.claimTransport()();
      await gate;
    });
    try {
      await expect(withStdioOutput(async () => {})).rejects.toThrow("already owns stdout");
    } finally { release(); await running; }
  });

  it("drains managed handlers before restoring application output", async () => {
    const stdout = process.stdout.write;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await withStdioOutput(async (lease) => {
      let completed = false;
      const work = lease.track(async () => { await gate; completed = true; });
      const draining = lease.drain();
      await Promise.resolve();
      expect(completed).toBe(false);
      release();
      await draining; await work;
      expect(completed).toBe(true);
      expect(process.stdout.write).not.toBe(stdout);
    });
    expect(process.stdout.write).toBe(stdout);
  });

  it("preserves protocol backpressure and flush callbacks on the captured writer", async () => {
    const stdout = process.stdout.write;
    const chunks: Buffer[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk, _encoding, callback) => {
      chunks.push(Buffer.from(chunk));
      setImmediate(() => callback?.());
      return false;
    }) as typeof process.stdout.write);
    try {
      await withStdioOutput(async (lease) => {
        expect(lease.protocolOutput.write(Buffer.alloc(128 * 1024, "x"))).toBe(false);
        await lease.drain();
        expect(Buffer.concat(chunks).length).toBe(128 * 1024);
      });
      expect(process.stdout.write).toBe(write);
    } finally { write.mockRestore(); }
    expect(process.stdout.write).toBe(stdout);
  });
});

describe("redirected diagnostic stream events", () => {
  it("forwards stderr drain to stdout only during ownership", async () => {
    const before = process.stderr.listenerCount("drain");
    const onDrain = vi.fn();
    process.stdout.on("drain", onDrain);
    try {
      await withStdioOutput(async () => {
        process.stderr.emit("drain");
        expect(onDrain).toHaveBeenCalledOnce();
      });
      process.stderr.emit("drain");
      expect(onDrain).toHaveBeenCalledOnce();
      expect(process.stderr.listenerCount("drain")).toBe(before);
    } finally { process.stdout.off("drain", onDrain); }
  });
});

describe("server-specific handler ownership", () => {
  it("does not wait for concurrent HTTP handlers when draining the stdio server", async () => {
    type Handler = () => Promise<void>;
    const makeServer = () => {
      let registered!: Handler;
      const server = { setRequestHandler: (_schema: unknown, callback: Handler) => { registered = callback; } };
      observeStdioWork(server as never);
      return { server, invoke: () => registered() };
    };
    const stdio = makeServer();
    const http = makeServer();
    let finishHttp!: () => void;
    const httpGate = new Promise<void>((resolve) => { finishHttp = resolve; });
    stdio.server.setRequestHandler({}, async () => {});
    http.server.setRequestHandler({}, async () => { await httpGate; });
    let httpFinished = false;
    await withStdioOutput(async (lease) => {
      const unbind = bindStdioWork(stdio.server as never, lease);
      const pendingHttp = http.invoke().then(() => { httpFinished = true; });
      try {
        await stdio.invoke();
        await lease.drain();
        expect(httpFinished).toBe(false);
      } finally { unbind(); finishHttp(); await pendingHttp; }
    });
  });
});

describe("protocol output failure", () => {
  it("propagates captured write failures and restores the original stdout writer", async () => {
    const failure = new Error("protocol pipe failed");
    const original = process.stdout.write;
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((_chunk, _encoding, callback) => {
      setImmediate(() => callback?.(failure));
      return false;
    }) as typeof process.stdout.write);
    try {
      await expect(withStdioOutput(async (lease) => {
        lease.protocolOutput.write("protocol");
        await lease.drain();
      })).rejects.toThrow("protocol pipe failed");
      expect(process.stdout.write).toBe(write);
    } finally { write.mockRestore(); }
    expect(process.stdout.write).toBe(original);
  });
});
