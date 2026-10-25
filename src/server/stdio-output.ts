/** Process-wide stdout reservation for one explicitly owned MCP stdio lifetime. */
import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate } from "node:timers/promises";
import { Writable } from "node:stream";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

const ownerContext = new AsyncLocalStorage<StdioOutputLease>();
let activeOwner: StdioOutputLease | undefined;

export class StdioOutputLease {
  readonly protocolOutput: Writable;
  private readonly originalWrite = process.stdout.write;
  private readonly diagnosticWrite = process.stderr.write.bind(process.stderr);
  private readonly diagnosticDrain = (): void => { process.stdout.emit("drain"); };
  private readonly stdoutError: (error: Error) => void;
  private released = false;
  private transportClaimed = false;
  private readonly pendingWork = new Set<Promise<unknown>>();

  constructor() {
    // The protocol writer bypasses only our JS redirection. Writable retains
    // native buffering, drain and write-callback error semantics for the SDK.
    this.protocolOutput = new Writable({
      write: (chunk, encoding, callback) => {
        this.originalWrite.call(process.stdout, chunk, encoding, callback);
      },
    });
    // Retain errors during bootstrap, before the transport attaches its listener.
    this.protocolOutput.on("error", () => {});
    this.stdoutError = (error) => { this.protocolOutput.destroy(error); };
    process.stdout.on("error", this.stdoutError);
    process.stderr.on("drain", this.diagnosticDrain);
    process.stdout.write = this.diagnosticWrite as typeof process.stdout.write;
  }

  claimTransport(): () => void {
    if (this.protocolOutput.destroyed) throw this.protocolOutput.errored ?? new Error("MCP protocol output closed");
    if (this.transportClaimed) throw new Error("An MCP stdio transport already owns stdout");
    this.transportClaimed = true;
    return () => { this.transportClaimed = false; };
  }

  track<T>(callback: () => T | Promise<T>): Promise<T> {
    const pending = Promise.resolve().then(callback);
    this.pendingWork.add(pending);
    void pending.finally(() => { this.pendingWork.delete(pending); }).catch(() => {});
    return pending;
  }

  async drain(): Promise<void> {
    do {
      await Promise.allSettled([...this.pendingWork]);
      // SDK response serialization follows handler completion in microtasks.
      await setImmediate();
    } while (this.pendingWork.size > 0);
    if (this.protocolOutput.destroyed) throw this.protocolOutput.errored ?? new Error("MCP protocol output closed");
    await new Promise<void>((resolve, reject) => {
      this.protocolOutput.write("", (error?: Error | null) => error ? reject(error) : resolve());
    });
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    process.stdout.write = this.originalWrite;
    process.stdout.off("error", this.stdoutError);
    process.stderr.off("drain", this.diagnosticDrain);
    if (activeOwner === this) activeOwner = undefined;
  }
}

/** Nested CLI/serve/transport calls share ownership; unrelated sessions fail. */
export async function withStdioOutput<T>(
  callback: (lease: StdioOutputLease) => Promise<T>,
): Promise<T> {
  if (activeOwner) {
    if (ownerContext.getStore() !== activeOwner) {
      throw new Error("Another MCP stdio session already owns stdout");
    }
    return callback(activeOwner);
  }
  const lease = new StdioOutputLease();
  activeOwner = lease;
  try {
    return await ownerContext.run(lease, () => callback(lease));
  } finally {
    lease.release();
  }
}

const observedServers = new WeakSet<Server>();
const serverOwners = new WeakMap<Server, StdioOutputLease>();

export function bindStdioWork(server: Server, lease: StdioOutputLease): () => void {
  serverOwners.set(server, lease);
  return () => { serverOwners.delete(server); };
}

/** Use only public registration APIs; retain SDK validation and schema wrapping. */
export function observeStdioWork(server: Server): void {
  if (observedServers.has(server)) return;
  observedServers.add(server);
  const setRequestHandler = server.setRequestHandler.bind(server);
  server.setRequestHandler = (schema, handler) => {
    setRequestHandler(schema, (request, extra) => {
      const lease = serverOwners.get(server);
      return lease ? lease.track(() => handler(request, extra)) : handler(request, extra);
    });
  };
}
