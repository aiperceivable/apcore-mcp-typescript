# Examples

Runnable demos of **apcore-mcp** with the Tool Explorer UI.

```
examples/
├── README.md                  # This file
├── run.ts                     # Unified launcher (all 5 modules)
├── extensions/                # Class-based apcore modules (using apcore-js types)
│   ├── text_echo.ts
│   ├── math_calc.ts
│   └── greeting.ts
└── binding_demo/              # Zero-code-intrusion demo
    ├── myapp.ts               # Plain business logic (NO apcore imports)
    └── run.ts                 # Wraps myapp functions via module() factory
```

## Quick Start (all modules together)

Both class-based modules and programmatic wrappers coexist in the same Registry.

```bash
# From the project root
npx tsx examples/run.ts
```

Open http://127.0.0.1:8000/explorer/ — you should see all 5 tools.

## Run class-based modules only

```bash
npx apcore-mcp \
  --extensions-dir ./examples/extensions \
  --transport streamable-http \
  --explorer --allow-execute
```

Uses the built-in CLI directly.

## Run programmatic modules only

```bash
npx tsx examples/binding_demo/run.ts
```

## All Modules

| Module | Type | Description |
|--------|------|-------------|
| `text_echo` | class-based | Echo text back, optionally uppercase |
| `math_calc` | class-based | Basic arithmetic (add, sub, mul, div) |
| `greeting` | class-based | Personalized greeting in 3 styles (friendly, formal, pirate) |
| `convert_temperature` | module() factory | Celsius / Fahrenheit / Kelvin conversion |
| `word_count` | module() factory | Count words, characters, and lines |

## Two Integration Approaches

| | Class-based | module() factory |
|---|---|---|
| Your code changes | Write apcore module with default export | **None** — wrap existing functions |
| apcore-js imports | `ModuleAnnotations`, `DEFAULT_ANNOTATIONS`, `Context` | `Registry`, `Executor`, `module` |
| Schema definition | TypeBox `Type.Object(...)` in module file | TypeBox in the launcher script |
| Launch | CLI `--extensions-dir` or `Registry.discover()` | `module({ ..., registry })` |
| Best for | New projects | Existing projects with functions to expose |
