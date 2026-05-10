/**
 * Markdown rendering for apcore modules via apcore-toolkit.
 *
 * LLMs read MCP/OpenAI tool `description` strings as their primary
 * signal for tool selection — the richer the description, the better
 * the agent picks the right tool. apcore-toolkit's
 * `formatModule({ style: "markdown" })` emits a canonical, cross-SDK
 * byte-equivalent rendering with title, description, parameters list,
 * returns list, behavior table, tags, and examples.
 *
 * This module bridges apcore's `ModuleDescriptor` (the runtime type
 * flowing through apcore-mcp) to apcore-toolkit's `ScannedModule`
 * (the input format `formatModule` expects), then delegates.
 *
 * apcore-toolkit is an OPTIONAL peer dependency in package.json (it
 * appears under `optionalDependencies`). Callers must check
 * {@link isMarkdownAvailable} before invoking
 * {@link renderModuleMarkdown}.
 */

import type { ModuleDescriptor } from "./types.js";

/**
 * Lazily-loaded apcore-toolkit module reference. We cache the loaded
 * module so repeated calls don't re-import it. The shape is typed
 * loosely because the import is dynamic; only `formatModule` is
 * actually invoked downstream — the local
 * {@link descriptorToScannedModule} adapter handles construction.
 */
interface ToolkitModule {
  formatModule: (
    module: Record<string, unknown>,
    options?: { style?: string; display?: boolean },
  ) => string | Record<string, unknown>;
}

let _toolkit: ToolkitModule | null | undefined;
let _toolkitLoaded = false;

async function loadToolkit(): Promise<ToolkitModule | null> {
  if (_toolkitLoaded) return _toolkit ?? null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("apcore-toolkit")) as any;
    const formatModule = mod.formatModule ?? mod.default?.formatModule;
    if (typeof formatModule === "function") {
      _toolkit = { formatModule };
    } else {
      _toolkit = null;
    }
  } catch {
    _toolkit = null;
  }
  _toolkitLoaded = true;
  return _toolkit ?? null;
}

/**
 * Synchronous availability check using a side-effect-free flag set by
 * {@link primeMarkdownToolkit}. Returns false until the toolkit has been
 * primed; callers that need to check before the first async render should
 * `await primeMarkdownToolkit()` at startup.
 */
export function isMarkdownAvailable(): boolean {
  return _toolkitLoaded && _toolkit !== null;
}

/**
 * Eagerly load apcore-toolkit so subsequent {@link isMarkdownAvailable}
 * checks return synchronously. Safe to call multiple times — the import
 * resolves to the same cached module.
 */
export async function primeMarkdownToolkit(): Promise<boolean> {
  await loadToolkit();
  return isMarkdownAvailable();
}

/**
 * Adapt an apcore `ModuleDescriptor` to a toolkit `ScannedModule`-shaped
 * object. The two types are near-supersets — overlapping fields are
 * copied verbatim, toolkit-only fields (`target`, `documentation`,
 * `suggestedAlias`, `warnings`) get sensible defaults.
 *
 * Note: apcore-mcp's `ModuleDescriptor` uses snake_case
 * (`module_id`, `input_schema`); apcore-toolkit's `ScannedModule` uses
 * camelCase (`moduleId`, `inputSchema`). We rename here.
 */
function descriptorToScannedModule(
  descriptor: ModuleDescriptor,
): Record<string, unknown> {
  // The TS `ModuleDescriptor` type doesn't declare a `display` field
  // (apcore-mcp-typescript predates apcore 0.19.0's display overlay)
  // but real instances coming from apcore-js may carry one — read it
  // through an index lookup so we don't lose the overlay when present.
  const display =
    (descriptor as unknown as { display?: Record<string, unknown> | null }).display ?? null;
  return {
    moduleId: descriptor.moduleId,
    description: descriptor.description ?? "",
    inputSchema: descriptor.inputSchema ?? {},
    outputSchema: descriptor.outputSchema ?? {},
    tags: [...(descriptor.tags ?? [])],
    target: "",
    version: descriptor.version ?? "1.0.0",
    annotations: descriptor.annotations ?? null,
    documentation: descriptor.documentation ?? null,
    suggestedAlias: null,
    examples: [...(descriptor.examples ?? [])],
    metadata: { ...(descriptor.metadata ?? {}) },
    display,
    warnings: [],
  };
}

/**
 * Render a `ModuleDescriptor` as canonical apcore-toolkit Markdown.
 *
 * Returns `null` when the toolkit hasn't been primed yet — callers that want
 * Markdown rendering inside synchronous code paths (like
 * `MCPServerFactory.buildTool`) MUST `await primeMarkdownToolkit()` during
 * their async startup so the cached reference is populated.
 *
 * Once primed, this function is a thin sync wrapper around `formatModule`
 * (which is itself synchronous in apcore-toolkit-js). Returns the Markdown
 * body — title, description, parameters list, returns list, behavior table
 * (toolkit 0.6.x emits only fields that differ from defaults), tags, and
 * examples.
 *
 * Returns `null` (not an error) when apcore-toolkit is not installed, so
 * callers can fall back to plain `descriptor.description`.
 */
export function renderModuleMarkdownSync(
  descriptor: ModuleDescriptor,
  options: { display?: boolean } = {},
): string | null {
  if (!_toolkitLoaded || !_toolkit) return null;
  const scanned = descriptorToScannedModule(descriptor);
  try {
    const rendered = _toolkit.formatModule(scanned, {
      style: "markdown",
      display: options.display ?? true,
    });
    return typeof rendered === "string" ? rendered : null;
  } catch {
    return null;
  }
}
