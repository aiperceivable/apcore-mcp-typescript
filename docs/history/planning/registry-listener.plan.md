# Implementation Plan: Registry Listener

## Feature
registry-listener

## Target
`src/server/listener.ts`

## Status: COMPLETED

## Dependencies
- `src/server/factory.ts` (MCPServerFactory)
- `src/types.ts` (Registry, ModuleDescriptor interfaces)
- `@modelcontextprotocol/sdk` (Tool type)

## Implementation Tasks

### Task 1: Create RegistryListener class skeleton
- **Status:** Done
- **File:** `src/server/listener.ts`
- **Details:** Export class with constructor accepting `Registry` and `MCPServerFactory`. Public `tools` getter returns snapshot copy. Public `start()`, `stop()`, `_onRegister()`, `_onUnregister()` methods.

### Task 2: Implement `start()` with idempotency
- **Status:** Done
- **Details:** Subscribe to `registry.on("register", ...)` and `registry.on("unregister", ...)`. Set `_active = true`. Guard against double-subscription with `_started` flag.

### Task 3: Implement `stop()`
- **Status:** Done
- **Details:** Set `_active = false`. Event callbacks check `_active` before processing, so stop effectively makes them no-ops.

### Task 4: Implement `_onRegister()`
- **Status:** Done
- **Details:** Get definition from `registry.get_definition(moduleId)`. If null, log warning and return. Build tool via factory, add to internal `Map<string, Tool>`. Log registration.

### Task 5: Implement `_onUnregister()`
- **Status:** Done
- **Details:** Remove tool from internal map by module ID. Log unregistration.

### Task 6: Implement `tools` getter with snapshot
- **Status:** Done
- **Details:** Return `new Map(this._tools)` to prevent external mutation of internal state.

## TDD Test Cases
- **File:** `tests/server/listener.test.ts`
- **Status:** 9 tests passing
- TC-LISTENER-001: start() subscribes to register and unregister events
- TC-LISTENER-002: start() is idempotent (no double-subscribe)
- TC-LISTENER-003: stop() prevents event handling
- TC-LISTENER-004: _onRegister adds tool to internal map
- TC-LISTENER-005: _onRegister skips null definition with warning
- TC-LISTENER-006: _onUnregister removes tool from map
- TC-LISTENER-EVENT-REGISTER: Register callback triggered via event system
- TC-LISTENER-EVENT-UNREGISTER: Unregister callback triggered via event system
- TC-LISTENER-007: tools getter returns snapshot copy
