# Feature: mcp-embedded-ui Integration and Authentication Hooks

**Commit:** 54448d12c8b4bc1e8a76a2e90195474d44eddb0e

### Problem
The initial "Tool Explorer" was a custom-built, static HTML/JS implementation that was difficult to extend and maintain. It lacked visual polish and didn't support advanced features like custom branding or integrated authentication for tool execution. Users needed a more professional and flexible UI for interactive testing.

### Why it needs to be fixed
By adopting the shared `mcp-embedded-ui` library, `apcore-mcp` benefits from a maintained, feature-rich component that provides a consistent experience across the `apcore` ecosystem. It also allows for better security integration, enabling authenticated tool calls directly from the browser-based UI.

### How it was resolved
1.  **UI Replacement**: Removed the custom `src/explorer/` logic and replaced it with the `mcp-embedded-ui` library.
2.  **Auth Hooks**: Implemented `buildExplorerAuthHook` to bridge the library's `Authenticator` with the UI's authentication requirements, enabling secure tool execution from the explorer.
3.  **Branding Support**: Added options for `explorerTitle`, `explorerProjectName`, and `explorerProjectUrl` to allow customization of the UI.
4.  **Transport Integration**: Updated `TransportManager` to handle explorer routing via the new `createNodeHandler` from the UI library.

### How it was verified
1.  **Explorer Tests**: Updated `tests/explorer/explorer.test.ts` to verify the new UI handler's routing, tool listing, and execution endpoints.
2.  **Auth Integration**: Enhanced `tests/auth/integration.test.ts` to ensure that GET requests to the explorer are exempt from global auth, while POST (execution) requests are properly handled by the new auth hook.
3.  **Custom Branding**: Manually verified that branding options are correctly passed to the UI handler.
