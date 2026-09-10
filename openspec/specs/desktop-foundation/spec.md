# desktop-foundation Specification

## Purpose

TBD - created by archiving change setup-orchestrai-desktop. Update Purpose after archive.

## Requirements

### Requirement: Reproducible desktop workspace

The application SHALL use a strict TypeScript monorepo with a Next.js App Router renderer, Tailwind CSS, desktop and package boundaries described in the design, a lockfile, and documented development, build, lint, format, and test commands. It MUST NOT use Bootstrap or a Vite renderer.

#### Scenario: Clean developer startup

- **WHEN** a developer installs locked dependencies and runs the documented startup command on macOS
- **THEN** Electron launches and renders the Next.js connection screen styled with Tailwind without needing a DAW or provider account

### Requirement: Offline exported Next.js renderer

Every custom protocol SHALL resolve paths before serving, reject traversal and symlink escapes, and serve only from its permitted source: the exported renderer for application assets, and the sample index for sample media.

#### Scenario: Sample protocol asked for an application file

- **WHEN** the sample protocol is asked for a path that is not an indexed sample
- **THEN** it refuses

### Requirement: Secure validated IPC

The renderer MUST run with context isolation and sandbox enabled and Node integration disabled. Preload SHALL expose named APIs with runtime-validated request and response schemas. Main SHALL reject untrusted sender frames, unknown channels, invalid input, and unapproved navigation.

#### Scenario: Invalid renderer request

- **WHEN** a renderer supplies malformed tempo input or an untrusted frame invokes an IPC handler
- **THEN** the request is rejected without tool execution or filesystem access

#### Scenario: Production isolation

- **WHEN** the production renderer attempts Node access or remote script loading
- **THEN** Node APIs are unavailable and the content security policy blocks the script

### Requirement: Durable local storage

Local storage SHALL apply schema migrations transactionally and preserve existing data across upgrades, including conversations, messages, tool calls, transactions, the sample index, and generated artifacts. A database at an unsupported future version SHALL be preserved and reported rather than modified.

#### Scenario: Upgrading to artifact storage

- **WHEN** an application holding schema 2 data starts with schema 3 support
- **THEN** the artifact table is added in a transaction and prior history and sample index remain readable

#### Scenario: Failed upgrade

- **WHEN** an upgrade fails partway
- **THEN** it rolls back and the database is left at its previous version

### Requirement: Recoverable process lifecycle

The application SHALL supervise runtime/database workers, expose failures, shut down child processes, and provide renderer error recovery without replaying writes.

#### Scenario: Runtime crash during a request

- **WHEN** the runtime exits unexpectedly
- **THEN** connection status becomes disconnected, unresolved calls become interrupted or unknown-outcome, approvals are invalidated, and the user can restart a fresh session

### Requirement: Structured local diagnostics

The application SHALL emit correlated structured local logs with request, tool, transaction, timestamp, and error fields where applicable, and redact secret values.

#### Scenario: Failed operation diagnostics

- **WHEN** a tool fails
- **THEN** its visible activity and diagnostic record share an identifier and contain a useful error without credential values
