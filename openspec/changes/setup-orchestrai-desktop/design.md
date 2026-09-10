## Context

This is a greenfield repository. The source PRD defines a broad music-production platform but explicitly limits initial development to Milestone 1. This design establishes contracts and a working desktop skeleton; mock operations prove application wiring without making claims about Cubase API support.

## Goals / Non-Goals

**Goals:** Launch a secure Electron app; persist local conversations and activity; detect agent executables; expose a real local MCP protocol endpoint; exercise capability discovery, permissions, and mock DAW commands through an inspectable interface.

**Non-Goals:** Live AI provider requests/authentication, launching CLI agent sessions, real Cubase discovery/control, MIDI routing or generation, sample scanning, audio analysis, plugin control, autonomous Agent mode, distribution signing, and auto-update. These correspond to later PRD work. The OpenAI deliverable here is an abstraction, not the full MVP connection feature.

## Decisions

### Workspace and ownership

Use pnpm workspaces, strict TypeScript, Electron, and Next.js App Router with React. Tailwind CSS is required for all interface styling: layout, typography, colors, interaction states, and responsive behavior. Define shared design tokens through Tailwind's theme configuration and use its PostCSS integration. Do not add Bootstrap, a separate component CSS framework, or a Vite renderer. Zustand and TanStack Query remain optional if implementation complexity warrants them. Use Vitest for unit/integration coverage and an Electron-capable smoke harness for the launch workflow. Pin compatible versions during implementation and commit the lockfile.

`apps/desktop` owns main/preload, a Next.js renderer project, and the local database service. `packages/shared-types` owns Zod schemas and normalized contracts. `agent-core` owns provider contracts and the demo provider. `agents/cli` owns discovery; `agents/openai` owns an injectable provider abstraction; `agents/claude` documents the future integration boundary. `orchestrator` owns tool dispatch and permissions; `mcp-server` owns MCP transport and runtime startup; `adapters/cubase` owns the mock adapter. Reserve `music-engine`, `sample-indexer`, and `audio-analysis` with package documentation only. A single application package would simplify initial setup but obscure the boundaries required for future DAWs/providers.

### Next.js desktop rendering

Configure the renderer with `output: 'export'` and fixed App Router pages for connection setup and the workspace. Conversation selection is client state, not an unbounded dynamic route. Interactive components use TypeScript and the client boundary; access `window.orchestra` after mounting or in event handlers, never during prerendering. Build-time rendering must not inspect local projects, SQLite, credentials, or agent installations. Server Actions, runtime API routes, request-time SSR, and a production Next.js server are outside this desktop design.

Development starts Next.js on loopback and Electron after its readiness check. Production bundles the exported HTML, scripts, styles, fonts, and assets and serves them through a registered secure standard application protocol such as `orchestra://app`. The protocol handler resolves only files inside the export directory, rejects path traversal, and maps the fixed pages and Next assets with correct MIME types. Verify navigation, refresh, hydration, and asset loading in the built desktop app. Use local fonts/assets and unoptimized images if using `next/image` so no runtime image server is required. Bundle Electron main/preload separately with an Electron-compatible TypeScript build tool.

Apply CSP through the application protocol responses, including build-generated hashes for any required inline Next.js hydration scripts; do not enable unrestricted inline scripts or eval in production. Test this early with the actual export. Retain IPC as the boundary for privileged local operations. A bundled Next.js runtime server was considered but adds a listener and process lifecycle that this local desktop skeleton does not need.

Implementation references: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports) and [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs).

### Process topology and security

Use a sandboxed renderer (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and a bundled preload with named methods only. Main validates the sender frame and exact allowed application origin, parses all IPC input and output using shared schemas, denies unapproved navigation/new windows, and applies a production CSP without remote script access. Development origin exceptions are explicit and unavailable in production.

Main supervises one bundled local MCP runtime child over private stdio using an MCP client. The child owns the orchestrator, demo provider, and mock adapter. Tool calls from desktop controls or demo chat both use this same runtime; MCP handlers never call the adapter around permission enforcement. No TCP listener or globally installed server is required. This is a real MCP stdio server, not a custom JSON-RPC imitation. External CLI wiring is deferred; an independently spawned server would own its own isolated mock session and must not claim to control the desktop session.

Main owns a SQLite worker and an application-only control channel to the runtime for session mode, approval decisions, and durable event acknowledgements. Agent-visible tools cannot grant approval or change permission policy. All child messages are schema validated and correlated by request/session ID. Child code paths and arguments are application controlled; discovery never executes candidates and model text never becomes a shell command. A main-process-only runtime was rejected to preserve responsiveness and fault isolation.

### Local storage and recovery

Use SQLite with a maintained driver compatible with the chosen Electron runtime; verify the native ABI early if using a native binding. Keep synchronous database work in its worker. Store the database under Electron's application user-data directory. Initial migrations create schema_migrations, settings, conversations, messages, tool_calls, and transactions; defer unused future tables. Apply versioned migrations transactionally and refuse normal operation on migration failure, preserving the database and surfacing a recoverable error.

Persist user messages before dispatch and record tool intent before a write executes. Store a terminal result after execution; activity IDs tie chat, tool requests, logs, and transactions together. On restart mark unfinished requests interrupted, invalidate pending approvals, and never automatically replay writes. If execution completed but result persistence failed, report an unknown outcome. Logs contain local structured diagnostics with secret fields redacted; future API credentials must use the OS credential store and are not accepted or stored in this milestone. Libraries and audio are never uploaded.

### Providers and executable discovery

Define AgentProvider with initialize, sendMessage, cancel, and getCapabilities, plus normalized conversation, response, and tool-call types. OpenAI uses an injectable transport boundary that can be tested without network access; its default implementation reports unavailable until a future connection integration exists. It must not silently substitute demo output. No model ID or provider-specific HTTP contract is fixed by this proposal.

Discovery searches inherited PATH followed by platform-specific common locations (including Homebrew, local user bins, and Windows executable extensions), validates candidates, deduplicates canonical paths, and returns per-candidate errors without failing the entire scan. Do not invoke a login shell, run --version, or inspect credential files. Treat Windows command shims as discovered candidates only. Surface installed/missing separately from session status; authentication remains unverified. Claude Code, Codex, and OpenAI CLI entries cannot enter Connected merely because files exist.

Use an explicitly selected Demo agent for deterministic prompts such as project inspection and setting mock tempo. Unsupported musical requests explain the milestone limit. Demo is not presented as Claude or OpenAI and makes no cloud calls. Real-provider execution was deferred because CLI permissions and authentication require their own integration design.

### Normalized tools and permissions

Define DawAdapter lifecycle, project state, execute, and dynamic capabilities. Initial music tools are project.get_state, project.get_tempo, project.set_tempo, transport.play, and transport.stop. Tool definitions contain an input schema, output schema, risk, and adapter capability ID. Advertise only supported tools for the current mode/session and recheck availability immediately before execution. Unsupported tools return a structured error even if a caller retained an old definition.

Ask allows reads and rejects writes. Assist executes reads and holds every write for explicit approval. Destructive tools always require approval if added later; none are registered initially. Persist pending calls with immutable tool arguments, initiating agent, and session identity. Approval is one-use, bound to those values, expires after five minutes, and is invalidated by disconnect, restart, or mode change. Serialize writes and recheck mode/capability after approval. Denial, timeout, and cancellation produce terminal activity without adapter execution. MCP requests may return a pending-approval result with an operation ID; the desktop shows the proposal and completion is delivered through the trusted runtime event channel.

Every invocation receives a transaction record, including reads, validation failures, denied calls, and errors; only successful reversible mock writes expose Undo. Mock inverse operations record prior tempo/transport state and require the state revision to match before restoring. Undo itself passes through permission enforcement as a normalized write. Do not expose generic Cubase project.undo or imply real-DAW undo support. A direct adapter call from the UI was rejected because it would bypass the central policy path.

### Workspace interaction

Connection setup offers Cubase 14 (Mock), detected agents, and Demo agent. Real connection and sample-library features carry explicit unavailable/later labels, with no false success controls. The production workspace has project navigation, central chat/composer, context and activity, and transport controls. It supports Ask/Assist, visible provider and adapter status, keyboard-accessible approvals, conversation reopening, and a developer console. Tool status progresses through requested, awaiting approval/running, and succeeded/failed/denied/cancelled/interrupted. Pending operations remain visible if the user changes conversations.

Renderer error boundaries and main-process crash detection offer controlled reload/restart. A runtime crash immediately disables writes, displays disconnection, and requires explicit restart; reconnect creates a fresh mock session and invalidates stale requests. Application shutdown cancels requests and closes runtime/database workers with bounded termination.

## Risks / Trade-offs

- [Mock success could be mistaken for Cubase support] → Persistent Mock badges, fixture labels, and a separate future bridge change.
- [macOS GUI PATH differs from terminal PATH] → Search documented common locations and show resolved paths with refresh; do not execute shell initialization scripts.
- [SQLite/Electron compatibility] → Validate the driver in a launched Electron process before building dependent features.
- [Approvals cross asynchronous process boundaries] → Bind immutable requests to a session and persist intent before executing; test replay and crash windows.
- [No live agent in the skeleton] → Demo proves orchestration locally while real entries honestly remain detected/unavailable.
- [Windows behavior differs] → Platform-aware paths and executable tests; run Windows build/type/unit checks when a runner is available and disclose untested interactive behavior.

## Migration Plan

Set up workspace tooling, then contracts/storage, mock/runtime, and UI. Introduce migration 001 for new installations; repeated startup must be idempotent. There is no legacy application data to migrate. If a migration fails, roll back that transaction and preserve the original database; never delete data to recover. Reverting application code must reject a newer incompatible schema instead of overwriting it. Document local development startup and the exact smoke-test workflow.

## Open Questions

No user decision blocks Milestone 1. During implementation verify Electron/SQLite/MCP dependency compatibility. Later changes must resolve real CLI session restriction/authentication, OS credential-store integration, Cubase MIDI Remote capabilities, and virtual MIDI setup. Product branding uses OrchestrAI provisionally as specified by the PRD.
