/**
 * Observability wiring for apcore-mcp.
 *
 * Bundles apcore-js's `MetricsCollector` + `MetricsMiddleware` and
 * `UsageCollector` + `UsageMiddleware` so the bridge can auto-install them
 * when the caller passes `observability: true` (or `metricsCollector: true`)
 * to `serve()`, `asyncServe()`, or the `APCoreMCP` constructor.
 *
 * Back-compat: when `metricsCollector` is already a concrete
 * `MetricsExporter` instance, it is passed through unchanged (existing
 * behaviour). When it is `true`, a fresh MetricsCollector is created
 * and the matching middleware installed via `executor.use()`.
 */

import type { MetricsExporter } from "./transport.js";

/** Duck-typed collector shapes returned from apcore-js. */
export interface ObservabilityStack {
  /** Prometheus exporter (also doubles as the /metrics source). */
  metricsCollector: MetricsExporter | undefined;
  /**
   * Raw UsageCollector with `getSummary(period)` and `getModule(moduleId, period)`.
   * Typed loose because the bridge never depends on apcore-js at compile time.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usageCollector: any | undefined;
  /** Middleware instances already installed on the executor. */
  middleware: unknown[];
}

/**
 * Flag-style options for observability auto-wiring. When `true` or an empty
 * config is passed, both metrics and usage middleware are installed.
 */
export type ObservabilityFlag =
  | boolean
  | {
      metrics?: boolean;
      usage?: boolean;
      buckets?: number[];
      retentionHours?: number;
    };

/**
 * Build the observability stack and install middleware on the executor.
 *
 * @param executor - apcore Executor instance (must expose `.use()` to install
 *   middleware). When `.use()` is missing, middleware installation is skipped
 *   with a warning and any instantiated collectors are still returned.
 * @param metricsCollector - Caller-supplied value. `true` → auto-instantiate.
 *   An existing `MetricsExporter` → pass through untouched. `undefined` /
 *   `false` → skip metrics.
 * @param observability - Master flag that additionally enables the usage
 *   middleware. When `true`, both metrics and usage are installed unless
 *   already supplied. Fine-grained sub-toggles supported via the object form.
 */
export async function installObservability(
  executor: unknown,
  metricsCollector: MetricsExporter | boolean | undefined,
  observability: ObservabilityFlag | undefined,
): Promise<ObservabilityStack> {
  const stack: ObservabilityStack = {
    metricsCollector: undefined,
    usageCollector: undefined,
    middleware: [],
  };

  const obsObj = typeof observability === "object" && observability !== null ? observability : null;
  const obsOn = observability === true || obsObj !== null;

  const wantMetrics =
    metricsCollector === true || (obsOn && (obsObj?.metrics ?? true));
  const wantUsage = obsOn && (obsObj?.usage ?? true);
  const hasPreMetrics =
    metricsCollector !== undefined &&
    metricsCollector !== null &&
    metricsCollector !== true &&
    metricsCollector !== false;

  // Back-compat: pre-instantiated MetricsExporter passed through.
  if (hasPreMetrics) {
    stack.metricsCollector = metricsCollector as MetricsExporter;
  }

  if (!wantMetrics && !wantUsage) {
    return stack;
  }

  let apcoreMod: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apcoreMod = (await import("apcore-js")) as any;
  } catch {
    console.warn(
      "[apcore-mcp] observability requested but apcore-js is not installed; skipping auto-wire.",
    );
    return stack;
  }
  const apcore = apcoreMod;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executorAny = executor as any;
  const useFn = typeof executorAny.use === "function" ? executorAny.use.bind(executorAny) : null;

  if (wantMetrics && !hasPreMetrics) {
    const MetricsCollector =
      (apcore.MetricsCollector as new (buckets?: number[]) => MetricsExporter) ??
      ((apcore as Record<string, unknown>).default as Record<string, unknown> | undefined)?.["MetricsCollector"];
    const MetricsMiddleware = apcore.MetricsMiddleware as
      | (new (collector: unknown) => unknown)
      | undefined;
    if (MetricsCollector) {
      const collector = new (MetricsCollector as new (buckets?: number[]) => MetricsExporter)(
        obsObj?.buckets,
      );
      stack.metricsCollector = collector;
      if (MetricsMiddleware && useFn) {
        const mw = new MetricsMiddleware(collector);
        useFn(mw);
        stack.middleware.push(mw);
      } else if (!useFn) {
        console.warn(
          "[apcore-mcp] Executor does not expose .use() — MetricsMiddleware not installed.",
        );
      }
    }
  }

  if (wantUsage) {
    const UsageCollector = apcore.UsageCollector as
      | (new (retentionHours?: number) => unknown)
      | undefined;
    const UsageMiddleware = apcore.UsageMiddleware as
      | (new (collector: unknown) => unknown)
      | undefined;
    if (UsageCollector) {
      const collector = new UsageCollector(obsObj?.retentionHours);
      stack.usageCollector = collector;
      if (UsageMiddleware && useFn) {
        const mw = new UsageMiddleware(collector);
        useFn(mw);
        stack.middleware.push(mw);
      } else if (!useFn) {
        console.warn(
          "[apcore-mcp] Executor does not expose .use() — UsageMiddleware not installed.",
        );
      }
    }
  }

  return stack;
}
