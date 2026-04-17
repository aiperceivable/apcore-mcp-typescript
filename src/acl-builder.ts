/**
 * Build an apcore `ACL` instance from a Config Bus `mcp.acl` section.
 *
 * Config Bus schema (YAML, shared across Python/TS/Rust bridges):
 *
 * ```yaml
 * mcp:
 *   acl:
 *     default_effect: deny          # or "allow" — default "deny" (fail-secure)
 *     rules:
 *       - callers: ["role:admin"]
 *         targets: ["sys.*"]
 *         effect: allow
 *         description: "Admins can reach system modules"
 *       - callers: ["*"]
 *         targets: ["sys.reload", "sys.toggle"]
 *         effect: deny
 *         conditions:
 *           identity_types: ["human", "system"]
 * ```
 *
 * Mirrors the Python `acl_builder.build_acl_from_config` contract. Invalid
 * entries throw so misconfiguration fails loudly at startup.
 */

const ALLOWED_EFFECTS = new Set(["allow", "deny"]);
const ALLOWED_RULE_KEYS = new Set([
  "callers",
  "targets",
  "effect",
  "description",
  "conditions",
]);

export interface AclConfigRule {
  callers: string[];
  targets: string[];
  effect: string;
  description?: string;
  conditions?: Record<string, unknown> | null;
}

export interface AclConfigSection {
  default_effect?: string;
  rules?: AclConfigRule[];
}

/**
 * Construct an apcore `ACL` from a Config Bus `mcp.acl` mapping.
 *
 * Returns `null` when `aclConfig` is falsy (no ACL section configured).
 * Throws on malformed entries.
 */
export async function buildAclFromConfig(
  aclConfig: unknown,
): Promise<unknown | null> {
  if (aclConfig === null || aclConfig === undefined) return null;
  if (typeof aclConfig !== "object" || Array.isArray(aclConfig)) {
    throw new Error(
      `mcp.acl must be a mapping with 'rules' and optional 'default_effect', ` +
        `got ${Array.isArray(aclConfig) ? "array" : typeof aclConfig}`,
    );
  }
  const cfg = aclConfig as Record<string, unknown>;
  const rulesRaw = cfg.rules;
  // Validate rules type up-front — even for empty configs — to keep errors
  // visible at startup rather than silently returning null.
  if (rulesRaw !== undefined && !Array.isArray(rulesRaw)) {
    throw new Error(`mcp.acl.rules must be a list, got ${typeof rulesRaw}`);
  }
  const hasRules = Array.isArray(rulesRaw) && rulesRaw.length > 0;
  const hasDefault = cfg.default_effect !== undefined;
  if (!hasRules && !hasDefault) {
    return null; // Empty config section — treat as no ACL
  }

  let apcore: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apcore = (await import("apcore-js")) as any;
  } catch (err) {
    throw new Error(
      `Config Bus 'mcp.acl' requires apcore-js>=0.18 with ACL support: ${
        (err as Error).message
      }`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ACL = (apcore.ACL ?? (apcore as any).default?.ACL) as
    | {
        new (
          rules: AclConfigRule[],
          defaultEffect?: string,
        ): unknown;
      }
    | undefined;
  if (!ACL) {
    throw new Error("apcore-js does not export ACL");
  }

  const defaultEffect = (cfg.default_effect ?? "deny") as string;
  if (!ALLOWED_EFFECTS.has(defaultEffect)) {
    throw new Error(
      `mcp.acl.default_effect must be 'allow' or 'deny', got '${defaultEffect}'`,
    );
  }

  const rawRules = (rulesRaw ?? []) as unknown[];

  const rules: AclConfigRule[] = [];
  for (let idx = 0; idx < rawRules.length; idx += 1) {
    const entry = rawRules[idx];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `mcp.acl.rules[${idx}] must be an object, got ${
          Array.isArray(entry) ? "array" : typeof entry
        }`,
      );
    }
    const rec = entry as Record<string, unknown>;
    const extra = Object.keys(rec).filter((k) => !ALLOWED_RULE_KEYS.has(k));
    if (extra.length) {
      throw new Error(
        `mcp.acl.rules[${idx}] got unexpected keys: ${extra.sort().join(", ")}`,
      );
    }

    const callers = rec.callers;
    const targets = rec.targets;
    const effect = rec.effect;

    if (!Array.isArray(callers) || callers.length === 0) {
      throw new Error(
        `mcp.acl.rules[${idx}] 'callers' must be a non-empty list`,
      );
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error(
        `mcp.acl.rules[${idx}] 'targets' must be a non-empty list`,
      );
    }
    if (typeof effect !== "string" || !ALLOWED_EFFECTS.has(effect)) {
      throw new Error(
        `mcp.acl.rules[${idx}] 'effect' must be 'allow' or 'deny', got '${effect}'`,
      );
    }

    const rule: AclConfigRule = {
      callers: [...(callers as string[])],
      targets: [...(targets as string[])],
      effect: effect as string,
      description: typeof rec.description === "string" ? rec.description : "",
    };
    if (rec.conditions !== undefined && rec.conditions !== null) {
      if (typeof rec.conditions !== "object" || Array.isArray(rec.conditions)) {
        throw new Error(
          `mcp.acl.rules[${idx}] 'conditions' must be an object or null`,
        );
      }
      rule.conditions = rec.conditions as Record<string, unknown>;
    }
    rules.push(rule);
  }

  return new ACL(rules, defaultEffect);
}
