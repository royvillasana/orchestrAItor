## 1. Workspace and launch foundation

- [x] 1.1 Create pnpm workspace manifests and the apps/packages layout from the design, including documented future package boundaries.
- [x] 1.2 Select compatible Electron, Next.js, React, Tailwind CSS/PostCSS, Zod, SQLite, and MCP dependencies; pin the toolchain and generate the lockfile without Bootstrap or a Vite renderer.
- [x] 1.3 Configure strict TypeScript, ESLint, Prettier, Vitest, and root development/build/typecheck/lint/format/test scripts.
- [x] 1.4 Configure the Next.js App Router TypeScript renderer, Tailwind theme/utilities, static export, and separate Electron main/preload build; launch development mode and verify SQLite loads inside Electron.
- [x] 1.5 Bundle the Next.js export through a secure application protocol with bounded file resolution, correct MIME types, and CSP hydration hashes; verify offline launch, fixed-page navigation, refresh, styles, and assets without a production Next.js server.

## 2. Shared contracts and process security

- [x] 2.1 Define Zod schemas and inferred types for project state, capabilities, DAW commands/results, providers, conversations, tool calls, transactions, and errors.
- [x] 2.2 Define narrow desktop IPC and runtime control/event contracts with request/session correlation and bounded input sizes.
- [x] 2.3 Configure renderer sandbox, isolation, disabled Node integration, production CSP, sender validation, and navigation/window restrictions.
- [x] 2.4 Add boundary tests for invalid input/output, untrusted senders, unsupported channels, and renderer isolation.

## 3. Local persistence and diagnostics

- [x] 3.1 Implement a SQLite worker and transactional migration 001 for schema versions, settings, conversations, messages, tool calls, and transactions in OS application data.
- [x] 3.2 Implement typed persistence operations for history, pending intents, terminal results, and interrupted/unknown outcomes.
- [x] 3.3 Add structured correlated logging with secret redaction and a bounded diagnostic event buffer.
- [x] 3.4 Test repeated startup, history persistence, migration rollback, incompatible schema handling, and failure to persist a write intent.

## 4. Agent discovery and provider boundaries

- [x] 4.1 Implement Claude Code, Codex, and OpenAI CLI discovery through PATH/common locations with canonical-path deduplication and no candidate execution.
- [x] 4.2 Test macOS and Windows paths/extensions, missing PATH, duplicate/symlink candidates, inaccessible files, and installed-versus-connected states.
- [x] 4.3 Implement the shared AgentProvider contract and injectable OpenAI abstraction with typed unavailable behavior and no default network calls.
- [x] 4.4 Implement the explicitly labeled Demo provider for project reads and tempo/transport proposals, including cancellation and unsupported-request responses.
- [x] 4.5 Test provider contract behavior and ensure demo output is never presented as a live provider response.

## 5. Mock DAW and orchestration

- [x] 5.1 Implement DawAdapter and MockCubaseAdapter lifecycle, deterministic fixture state, revision tracking, and supported/unsupported capability reporting.
- [x] 5.2 Implement and test mock project state, tempo read/set bounds, play/stop, disconnected errors, and unsupported commands.
- [x] 5.3 Build the typed music-tool registry with input/output validation, capability/mode filtering, and execution-time revalidation.
- [x] 5.4 Implement Ask read-only policy and Assist approvals with immutable arguments, session/agent binding, expiry, one-use decisions, invalidation, and serialized writes.
- [x] 5.5 Wire durable intent acknowledgement before writes and correlated terminal transactions/activity for all invocation outcomes.
- [x] 5.6 Implement successful mock-write snapshots and permission-controlled Undo with state-revision conflict detection.
- [x] 5.7 Test direct-call permission bypass attempts, approval replay/expiry/cancellation, mode changes, capability loss, storage failure, and undo conflicts.

## 6. Supervised MCP runtime

- [x] 6.1 Implement MCP stdio initialization, tools/list, and tools/call around the shared orchestrator using the selected SDK and schema-valid results.
- [x] 6.2 Start the bundled runtime child from Electron main with private stdio and a validated application-only control/event channel; keep diagnostics off stdout.
- [x] 6.3 Connect mode, provider, mock session, approval, persistence acknowledgements, and activity events across the trusted control channel without exposing approval-grant tools to agents.
- [x] 6.4 Implement startup timeout, unexpected exit handling, pending-request invalidation, explicit restart, and bounded child shutdown.
- [x] 6.5 Run MCP client integration tests for initialization/list/read, pending writes, approved completion, malformed calls, and crash recovery without write replay.

## 7. Connection and production interface

- [x] 7.1 Implement all UI styling with Tailwind utilities and shared theme tokens, including dark mode and keyboard-accessible connection setup with Cubase Mock, Demo, refreshable discovery, and accurate unavailable states.
- [x] 7.2 Build project/context views, provider/DAW indicators, conversation list, persisted chat/composer, and Ask/Assist selection.
- [x] 7.3 Connect chat to the demo provider and runtime through mounted Next.js client components and typed preload IPC; keep prerendering independent of desktop APIs and display actual results, cancellation, and unsupported-feature explanations.
- [x] 7.4 Build tool activity cards with arguments/status, approval/cancel actions, expiry handling, cross-conversation pending visibility, and eligible Undo actions.
- [x] 7.5 Connect transport controls through the same permission path and disable unavailable writes in Ask/disconnected states.
- [x] 7.6 Add developer console, renderer error boundaries, process failure display, and explicit recovery actions.

## 8. Milestone acceptance and handoff

- [x] 8.1 Run an Electron smoke workflow: launch without external accounts, connect Mock plus Demo, inspect project in Ask, switch to Assist, propose 124 BPM, cancel once, approve once, and verify state/activity.
- [x] 8.2 Verify approved transport and Undo, reopen persisted history after restart, and confirm no operation is automatically replayed.
- [x] 8.3 Inject runtime failure and verify disconnection, approval invalidation, preserved history, explicit restart, and cleanup on app exit.
- [x] 8.4 Run typecheck, lint, formatting checks, unit/integration tests, and production build; smoke-test the built Electron output on macOS and record Windows verification limitations.
- [x] 8.5 Document setup/start commands, architecture/process boundaries, data/log locations, demo prompts, tested behavior, and deferred Milestone 2/3 integrations in the README.
