# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-02-18

### Fixed

- **Circular `$ref` detection in SchemaConverter** — Self-referencing or mutually recursive `$ref` (e.g., TreeNode with children: TreeNode[]) now throws a descriptive `Circular $ref detected` error instead of causing infinite recursion / stack overflow.
- **Request body size limit in HTTP transports** — `readBody()` now enforces a maximum body size (default 4MB) to prevent memory exhaustion DoS. Oversized requests receive HTTP 413; malformed JSON receives HTTP 400.

### Added

- Environment variable `APCORE_MAX_BODY_BYTES` to configure the maximum request body size for HTTP transports (StreamableHTTP and SSE). Defaults to 4,194,304 (4MB).

## [0.1.0] - 2026-02-17

### Added

- Initial project setup with MCP server, schema conversion, transport management, and OpenAI tools bridge.
