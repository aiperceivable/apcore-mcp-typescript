/**
 * ApprovalStore: pluggable persistence interface for Phase B approval polling.
 *
 * Users supply a concrete implementation (Redis, DB, etc.).
 * InMemoryApprovalStore is provided for testing and local development only —
 * it does NOT survive process restarts and is not suitable for production.
 */

export interface ApprovalRecord {
  status: "pending" | "approved" | "rejected";
  moduleId: string;
  reason: string | null;
  createdAt: number;       // Date.now() ms
  resolvedAt: number | null;
}

/** Pluggable storage for Phase B approval state. */
export interface ApprovalStore {
  savePending(approvalId: string, moduleId: string, arguments_: Record<string, unknown>): Promise<void>;
  getResult(approvalId: string): Promise<ApprovalRecord | null>;
  resolve(approvalId: string, options: { approved: boolean; reason?: string }): Promise<boolean>;
}

interface InternalRecord extends ApprovalRecord {
  arguments_?: Record<string, unknown>;
}

/**
 * In-process approval store for testing and local development.
 *
 * NOT suitable for production: state is lost on restart, not shared
 * across processes.
 *
 * Memory management:
 * - Resolved records deleted after `resolvedTtlMs` (default 120 000 ms)
 * - Pending records abandoned without resolution deleted after `pendingTtlMs` (default 3 600 000 ms)
 * - Background sweep every `sweepIntervalMs` (default 300 000 ms)
 * - Hard cap `maxRecords` with oldest-pending eviction
 */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly resolvedTtlMs: number;
  private readonly pendingTtlMs: number;
  private readonly sweepIntervalMs: number;
  private readonly maxRecords: number;

  private records = new Map<string, InternalRecord>();
  private resolvers = new Map<string, (record: InternalRecord) => void>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    resolvedTtlMs?: number;
    pendingTtlMs?: number;
    sweepIntervalMs?: number;
    maxRecords?: number;
  } = {}) {
    this.resolvedTtlMs = options.resolvedTtlMs ?? 120_000;
    this.pendingTtlMs = options.pendingTtlMs ?? 3_600_000;
    this.sweepIntervalMs = options.sweepIntervalMs ?? 300_000;
    this.maxRecords = options.maxRecords ?? 10_000;
  }

  start(): void {
    if (this.sweepTimer !== null) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    if (typeof this.sweepTimer === "object" && this.sweepTimer !== null && "unref" in this.sweepTimer) {
      (this.sweepTimer as { unref(): void }).unref(); // don't block process exit
    }
  }

  stop(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  async savePending(approvalId: string, moduleId: string, arguments_: Record<string, unknown>): Promise<void> {
    if (this.records.size >= this.maxRecords) {
      this.evictOldestPending();
    }
    const now = Date.now();
    this.records.set(approvalId, {
      status: "pending",
      moduleId,
      arguments_,
      reason: null,
      createdAt: now,
      resolvedAt: null,
    });
    setTimeout(() => this.deleteRecord(approvalId), this.pendingTtlMs);
  }

  async getResult(approvalId: string): Promise<ApprovalRecord | null> {
    const rec = this.records.get(approvalId);
    if (!rec) return null;
    // Return public fields only (omit arguments_)
    return {
      status: rec.status,
      moduleId: rec.moduleId,
      reason: rec.reason,
      createdAt: rec.createdAt,
      resolvedAt: rec.resolvedAt,
    };
  }

  async resolve(approvalId: string, options: { approved: boolean; reason?: string }): Promise<boolean> {
    const rec = this.records.get(approvalId);
    if (!rec || rec.status !== "pending") return false;

    rec.status = options.approved ? "approved" : "rejected";
    rec.reason = options.reason ?? null;
    rec.resolvedAt = Date.now();
    delete rec.arguments_; // reclaim memory

    const resolver = this.resolvers.get(approvalId);
    if (resolver) {
      resolver(rec);
      this.resolvers.delete(approvalId);
    }

    setTimeout(() => this.deleteRecord(approvalId), this.resolvedTtlMs);
    return true;
  }

  /** Wait until resolved or timeout. Helper for tests. */
  async waitForResolution(approvalId: string, timeoutMs = 300_000): Promise<ApprovalRecord | null> {
    const rec = this.records.get(approvalId);
    if (!rec) return null;
    if (rec.status !== "pending") return rec;

    return new Promise<ApprovalRecord | null>((resolve) => {
      const timer = setTimeout(() => {
        this.resolvers.delete(approvalId);
        resolve(this.records.get(approvalId) ?? null);
      }, timeoutMs);

      this.resolvers.set(approvalId, (resolved) => {
        clearTimeout(timer);
        resolve(resolved);
      });
    });
  }

  private deleteRecord(approvalId: string): void {
    this.records.delete(approvalId);
    this.resolvers.delete(approvalId);
  }

  private evictOldestPending(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, rec] of this.records) {
      if (rec.status === "pending" && rec.createdAt < oldestTime) {
        oldestTime = rec.createdAt;
        oldestId = id;
      }
    }
    if (oldestId !== null) {
      this.deleteRecord(oldestId);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, rec] of this.records) {
      if (rec.status === "pending" && now - rec.createdAt > this.pendingTtlMs) {
        this.deleteRecord(id);
      } else if (rec.status !== "pending" && rec.resolvedAt !== null && now - rec.resolvedAt > this.resolvedTtlMs) {
        this.deleteRecord(id);
      }
    }
  }
}
