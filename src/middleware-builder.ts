/**
 * Build apcore middleware instances from Config Bus `mcp.middleware` entries.
 *
 * Config Bus schema (YAML, snake_case — matches Python/Rust bridges):
 *
 * ```yaml
 * mcp:
 *   middleware:
 *     - type: retry
 *       max_retries: 3
 *       strategy: exponential
 *       base_delay_ms: 100
 *       max_delay_ms: 5000
 *       jitter: true
 *     - type: logging
 *       log_inputs: true
 *       log_outputs: true
 *       log_errors: true
 *     - type: error_history
 *       max_entries_per_module: 50
 *       max_total_entries: 1000
 * ```
 *
 * Config Bus keys are snake_case (cross-language convention). The builder
 * translates them to the camelCase fields the TypeScript apcore-js constructors
 * expect. Mirrors the Python `middleware_builder.build_middleware_from_config`
 * and Rust `middleware_builder::build_middleware_from_config` contracts.
 * Unknown `type` throws so misconfiguration fails loudly at startup.
 */

export interface MiddlewareConfigEntry {
  type: string;
  [key: string]: unknown;
}

/**
 * Convert snake_case → camelCase, preserving single-word keys unchanged.
 */
function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Construct apcore middleware instances from Config Bus entries.
 *
 * Returns an empty array if `entries` is empty or apcore-js is not installed.
 * Throws on unknown `type` or malformed entry.
 */
export async function buildMiddlewareFromConfig(
  entries: MiddlewareConfigEntry[] | null | undefined,
): Promise<unknown[]> {
  if (!entries || entries.length === 0) {
    return [];
  }

  let apcore: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apcore = (await import("apcore-js")) as any;
  } catch (err) {
    throw new Error(
      `Config Bus 'mcp.middleware' requires apcore-js>=0.18 with middleware support: ${
        (err as Error).message
      }`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolve = <T>(name: string): T | undefined =>
    (apcore[name] ?? (apcore as any).default?.[name]) as T | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RetryMiddleware = resolve<any>("RetryMiddleware");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LoggingMiddleware = resolve<any>("LoggingMiddleware");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ErrorHistoryMiddleware = resolve<any>("ErrorHistoryMiddleware");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ErrorHistory = resolve<any>("ErrorHistory");

  const instances: unknown[] = [];
  for (let idx = 0; idx < entries.length; idx += 1) {
    const entry = entries[idx];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `mcp.middleware[${idx}] must be an object with a 'type' key`,
      );
    }
    const { type, ...kwargs } = entry;
    if (!type || typeof type !== "string") {
      throw new Error(`mcp.middleware[${idx}] missing required 'type' key`);
    }

    switch (type) {
      case "retry": {
        if (!RetryMiddleware) {
          throw new Error("apcore-js does not export RetryMiddleware");
        }
        // Map snake_case Config Bus keys → camelCase RetryConfig fields.
        const cfg: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(kwargs)) {
          cfg[snakeToCamel(k)] = v;
        }
        instances.push(
          Object.keys(cfg).length
            ? new RetryMiddleware(cfg)
            : new RetryMiddleware(),
        );
        break;
      }
      case "logging": {
        if (!LoggingMiddleware) {
          throw new Error("apcore-js does not export LoggingMiddleware");
        }
        const opts: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(kwargs)) {
          opts[snakeToCamel(k)] = v;
        }
        instances.push(
          Object.keys(opts).length
            ? new LoggingMiddleware(opts)
            : new LoggingMiddleware(),
        );
        break;
      }
      case "error_history": {
        if (!ErrorHistoryMiddleware || !ErrorHistory) {
          throw new Error(
            "apcore-js does not export ErrorHistoryMiddleware or ErrorHistory",
          );
        }
        const maxPerModule = kwargs["max_entries_per_module"] as
          | number
          | undefined;
        const maxTotal = kwargs["max_total_entries"] as number | undefined;
        const allowedKeys = new Set([
          "max_entries_per_module",
          "max_total_entries",
        ]);
        const extra = Object.keys(kwargs).filter((k) => !allowedKeys.has(k));
        if (extra.length) {
          throw new Error(
            `mcp.middleware[${idx}] (error_history) got unexpected keys: ${extra
              .sort()
              .join(", ")}`,
          );
        }
        const history = new ErrorHistory(maxPerModule ?? 50, maxTotal ?? 1000);
        instances.push(new ErrorHistoryMiddleware(history));
        break;
      }
      default:
        throw new Error(
          `mcp.middleware[${idx}] unknown type '${type}'. ` +
            "Known built-in types: retry, logging, error_history",
        );
    }
  }

  return instances;
}
