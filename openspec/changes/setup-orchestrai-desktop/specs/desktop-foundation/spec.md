## ADDED Requirements

### Requirement: Reproducible desktop workspace

The application SHALL use a strict TypeScript monorepo with a Next.js App Router renderer, Tailwind CSS, desktop and package boundaries described in the design, a lockfile, and documented development, build, lint, format, and test commands. It MUST NOT use Bootstrap or a Vite renderer.

#### Scenario: Clean developer startup

- **WHEN** a developer installs locked dependencies and runs the documented startup command on macOS
- **THEN** Electron launches and renders the Next.js connection screen styled with Tailwind without needing a DAW or provider account

### Requirement: Offline exported Next.js renderer

Production SHALL bundle the Next.js static export and load it through a secure application protocol without a Next.js runtime server or internet access. Desktop data access SHALL use typed preload IPC from mounted client components. Prerendering MUST NOT require desktop APIs or access user data.

#### Scenario: Built application offline

- **WHEN** the production application launches offline and the user navigates between setup and the workspace and reloads
- **THEN** exported pages, hydration scripts, Tailwind styles, and local assets load successfully under production CSP without a web server

#### Scenario: Protocol path escape

- **WHEN** a resource request attempts to resolve outside the bundled export directory
- **THEN** the protocol handler rejects it without reading the external file

### Requirement: Secure validated IPC

The renderer MUST run with context isolation and sandbox enabled and Node integration disabled. Preload SHALL expose named APIs with runtime-validated request and response schemas. Main SHALL reject untrusted sender frames, unknown channels, invalid input, and unapproved navigation.

#### Scenario: Invalid renderer request

- **WHEN** a renderer supplies malformed tempo input or an untrusted frame invokes an IPC handler
- **THEN** the request is rejected without tool execution or filesystem access

#### Scenario: Production isolation

- **WHEN** the production renderer attempts Node access or remote script loading
- **THEN** Node APIs are unavailable and the content security policy blocks the script

### Requirement: Durable local storage

The application SHALL initialize SQLite in OS application data using transactional versioned migrations and persist settings, conversations, messages, tool calls, and transactions. Database work SHALL run outside the renderer and main UI thread. Credentials MUST NOT be stored in database/config/log plaintext.

#### Scenario: Repeated startup

- **WHEN** the application restarts after saving a conversation
- **THEN** its history remains available and already-applied migrations are not repeated

#### Scenario: Migration failure

- **WHEN** a migration fails
- **THEN** the migration transaction rolls back, existing data is preserved, and the application shows a recovery error without dispatching tools

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
