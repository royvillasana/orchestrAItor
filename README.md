# OrchestrAI

A local-first music-production workspace built with **Electron, Next.js App Router, strict TypeScript, and Tailwind CSS**.

This repository implements Milestone 1: a working desktop skeleton with a clearly labeled **Cubase Mock** adapter and deterministic **Demo agent**. No real Cubase project is controlled, and no live model account is used.

## Run

Requires Node.js 20.19 or newer and pnpm 10.20.0. The desktop smoke workflow is verified on macOS; Windows paths have automated coverage, but an interactive Windows launch has not been verified.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The development command builds Electron main/preload and workers, starts Next.js on `127.0.0.1:3210`, waits for readiness, and opens Electron. Renderer changes refresh through Next.js. Restart `pnpm dev` after changing main/preload/runtime/worker code.

To run the production export without a web server:

```sh
pnpm build
pnpm start
```

The exported Next.js pages and Tailwind assets load through `orchestra://app`. There is no production Next.js server, Server Action, API route, or cloud backend. The build is a runnable local desktop bundle; signed installers and auto-updates are deferred.

## Try the milestone

1. Choose **Open demo studio**. The setup screen also reports detected Claude Code, Codex, and OpenAI CLI executables. Detected does not mean authenticated or connected.
2. Send **Inspect the project** in Ask mode. The read appears in Tool Activity.
3. Switch to **Assist**, then send **Set tempo to 124 BPM**.
4. Cancel the first proposal. Tempo stays at 122. Send it again and approve: the mock project changes to 124 BPM.
5. Try the transport buttons. Each write requests approval. **Undo change** proposes restoring prior mock state and rejects conflicts with newer changes.
6. Open the developer console to inspect correlated local events. Create or reopen conversations from the sidebar.

The mock transport produces no audio. Requests for sample search, MIDI generation, or plugin control explain their unavailability. The Demo agent is intentionally deterministic and is never presented as a live Claude/OpenAI response.

## Architecture

```text
apps/desktop/
  renderer/             Next.js App Router + Tailwind
  electron/             Main, narrow preload, supervision, SQLite worker
packages/
  shared-types/         Zod schemas and normalized contracts
  agent-core/           AgentProvider and local Demo provider
  agents/cli/           Non-executing CLI discovery
  agents/openai/        Injectable OpenAI provider abstraction
  agents/claude/        Reserved live Claude integration
  orchestrator/         Registry dispatch, permissions, transactions, Undo
  mcp-server/           MCP stdio runtime in a supervised child process
  adapters/cubase/      Mock Cubase implementation of DawAdapter
  music-engine/         Reserved for Milestone 3
  sample-indexer/       Reserved for Milestone 3
  audio-analysis/       Reserved for later analysis
```

Electron main uses an MCP client over private stdio to reach the runtime. The child owns the demo provider, permission engine, and mock adapter. Desktop transport and demo chat enter the same orchestrator path. A separate validated process channel carries application control, user approval decisions, and persistence acknowledgements; no agent-visible tool can grant its own approval.

The renderer has context isolation and sandbox enabled, Node integration disabled, an allowlisted preload API, frame/origin checks, and restricted navigation. Production CSP hashes the inline hydration scripts in the exported HTML. Privileged work uses typed IPC only. The application protocol rejects traversal and symlink escapes outside the export directory.

Available normalized tools:

- `project.get_state`
- `project.get_tempo`
- `project.set_tempo` (20–300 BPM in the mock)
- `transport.play`
- `transport.stop`

Ask exposes reads and denies writes at execution time. Assist requires approval for every write. Approvals bind immutable arguments to a request and session, expire after five minutes, are consumed once, and are invalidated on cancellation, mode change, disconnect, or restart. Writes are serialized and capability-checked again immediately before execution.

The bundled MCP entry is intended to be supervised by the desktop. Starting it separately initializes an isolated, disconnected server; without its trusted persistence channel, it fails closed. Connecting external CLI agents is future work.

## Local data and recovery

Data lives in Electron's OS application-data directory under `OrchestrAI`:

- macOS: `~/Library/Application Support/OrchestrAI/`
- Windows: `%APPDATA%/OrchestrAI/`
- `orchestrai.sqlite`: settings, conversations, messages, tool calls, transactions, and migration versions.
- `events.jsonl`: structured local diagnostics with secret patterns redacted.

SQLite runs through `sql.js` in a worker, avoiding native Electron ABI rebuilds. Each mutation commits and writes an atomic checkpoint before acknowledging durability. This is appropriate for the skeleton's metadata; large sample catalogs will need a storage performance review before Milestone 3. One application instance owns the database. The database is local but not encrypted, so conversations should not contain API credentials. No API-key entry/storage is implemented yet; future credentials must use the OS credential store.

Runtime failure disables writes and offers **Restart runtime**, followed by an explicit mock connection. History is retained; unfinished calls become interrupted or unknown-outcome and are never replayed. A fresh runtime starts from fixture tempo/state. Historical Undo controls are unavailable in a new session. Migration failures preserve the existing database and surface an error rather than deleting or recreating it. Back up the closed application's data directory before manual maintenance.

For isolated testing, `ORCHESTRA_DATA_DIR` selects a separate application-data directory. The smoke harness always creates its own temporary directory.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:smoke
pnpm audit --prod
```

`pnpm test` builds the runtime entries before exercising unit and real-process integration tests. Coverage includes schema rejection, protocol initialization, SQLite migration rollback/history, CLI discovery, provider contracts, policy bypass attempts, approval replay/expiry/cancellation, persistence failure, and conflicting Undo.

The macOS Electron smoke harness checks actual rendered UI behavior: offline production loading, renderer isolation, chat, approval/cancellation, tempo, transport, Undo, reload, persisted history, a forced crash of its own runtime child, explicit recovery, and child cleanup. It saves screenshots to ignored `artifacts/`. It does not touch real DAWs or user libraries. The crash-injection portion uses macOS/POSIX process inspection and is not a Windows smoke harness.

For development-mode smoke verification, start `pnpm --filter @orchestrai/desktop dev:renderer` in one terminal, then run `node scripts/smoke.mjs --dev` in another after building the desktop entries.

## Next milestones

Milestone 2 introduces the real Cubase MIDI Remote/virtual MIDI bridge and capability handshake. Milestone 3 introduces sample folders/indexing/preview and MIDI artifacts. Live CLI sessions, API authentication and credential storage, plugin operations, and autonomous Agent mode remain separate integrations. The active implementation checklist is `openspec/changes/setup-orchestrai-desktop/tasks.md`.
