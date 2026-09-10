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

Available normalized tools (the mock supports all of them; a live bridge exposes what its handshake reports):

- `project.get_state`
- `project.get_tempo`
- `project.set_tempo` (20–300 BPM in the mock)
- `transport.play`
- `transport.stop`

Ask exposes reads and denies writes at execution time. Assist requires approval for every write. Approvals bind immutable arguments to a request and session, expire after five minutes, are consumed once, and are invalidated on cancellation, mode change, disconnect, or restart. Writes are serialized and capability-checked again immediately before execution.

The bundled MCP entry is intended to be supervised by the desktop. Starting it separately initializes an isolated, disconnected server; without its trusted persistence channel, it fails closed. Connecting external CLI agents is future work.

## Cubase bridge (Milestone 2)

Cubase exposes no local HTTP or IPC surface, so the bridge speaks to a **MIDI Remote driver script** running inside Cubase over a MIDI port pair. The connection screen offers **Cubase 14 · Mock** and **Cubase · Live bridge** as separate choices. A bridge that cannot connect stays disconnected and says why; it is never silently replaced by the mock.

Requests and responses are System Exclusive frames:

```text
F0 7D <protocol> <kind> <correlation> <len-hi> <len-lo> <payload…> <checksum> F7
```

Payloads are JSON encoded 8-to-7 so arbitrary UTF-8 survives MIDI, capped at 4 KB, and never fragmented. Every request carries a correlation value and a timeout; a response that never arrives fails the request and disconnects the bridge, so a dropped write is never reported as applied. On connect, a handshake exchanges protocol versions and returns the Cubase version and the operations the script implements — **tool exposure comes from that report**, not from a static list, and a protocol mismatch fails the connection naming both versions.

### Setting up the bridge

```sh
pnpm add -w -D @julusian/midi   # optional MIDI backend
pnpm install:cubase-script      # copies the driver script into Cubase
```

The script lands in `~/Documents/Steinberg/Cubase/MIDI Remote/Driver Scripts/Local/OrchestrAI/Bridge/` (`%USERPROFILE%\Documents\...` on Windows). Cubase reads that folder at startup, so it can be installed before Cubase has ever been launched.

No IAC bus or loopMIDI setup is needed: when no `OrchestrAI Bridge` port pair exists, connecting the bridge **publishes its own CoreMIDI endpoints** under that name. Those ports exist only while the bridge is connecting or connected, so the order matters:

1. Start Cubase (12 or newer).
2. In OrchestrAI, choose **Cubase · Live bridge** and connect. The ports appear and the handshake retries for 60 seconds.
3. While it waits, pair **OrchestrAI Bridge** in Cubase's _MIDI Remote Manager_, and make sure its mapping page is active — the script refuses writes until Cubase activates the page.

The handshake completes as soon as the script answers, and the header then shows the Cubase version with a `live` indicator.

The MIDI backend is an **optional** dependency, deliberately not installed by default, so `pnpm install` still never triggers an Electron native rebuild. Without it the bridge reports itself unavailable with the install command, and the mock stays fully usable. Install it with `pnpm add -w -D @julusian/midi`.

### What is verified, and what is not

Three layers of automated coverage, each closer to a real session:

1. **Protocol** — round trips, corrupt/foreign/truncated frames, unmatched correlations, oversized payloads, and timeout-driven disconnect over an in-process loopback. The **shipped driver script** is asserted to encode and decode byte-for-byte identically to the host implementation.
2. **Driver script** — the shipped script is loaded against a stub shaped after Cubase 15's own `midiremote_api_v1` definition, covering device/port registration, the transport value bindings, `setTempoBPM` with the active mapping, and its refusal to write before Cubase activates the mapping page.
3. **Live path over real MIDI** (`tests/cubase-bridge-live.test.ts`) — the driver script runs on **real CoreMIDI endpoints** while the supervised runtime child connects to it as it would to Cubase. Real ports, real SysEx bytes on the wire, a real handshake, Ask-mode refusal, and an approved tempo write arriving as `setTempoBPM(mapping, 124)`. Skipped automatically where the optional MIDI backend is not installed.

`pnpm test:smoke-bridge` runs the same peer under the built desktop application: it selects the bridge, connects over real MIDI, approves a tempo write, and asserts the interface never labels a live session as mock state. `node scripts/cubase-peer.mjs` runs the peer standalone, publishing `OrchestrAI Bridge` ports you can connect the app to by hand. Only one peer may publish those ports at a time.

What remains unverified is exactly one thing: **Cubase's own interpretation of those API calls**. Everything up to the moment Cubase receives them is covered. To close that last gap, follow the setup above with Cubase running — a Steinberg trial license is sufficient — then approve a tempo change and confirm it in Cubase's transport panel. Windows bridge verification is deferred alongside the existing Windows smoke limitation.

## Live agents (Milestone 3)

The **Demo agent** is deterministic and stays the default. Claude Code and Codex can be connected as the creative partner instead, and their tool calls land on the same registry, permission engine, adapter, and Undo as the Demo agent's — there is no second route to the DAW.

```text
CLI agent → MCP proxy (agent-mcp) → token-guarded local channel → orchestrator
                                                                → permission engine → adapter
```

The runtime opens a token-guarded local channel and the CLI is launched with a small MCP stdio proxy that forwards `tools/list` and `tools/call` to it. The channel carries **only** those two operations: an agent cannot approve its own write, select an adapter, or reach persistence. Approval stays a desktop action.

### Setup

Both CLIs use their own existing login; OrchestrAI reads, stores, and forwards no credentials.

1. Sign in where you normally would: `claude auth login` or `codex login`.
2. In the connection screen, press **Verify sign-in** on that provider. Discovery still never executes anything — verification is a separate, explicit step that runs only the CLI's own status command.
3. Select the provider and connect. The header, composer, and every message name the provider that produced them.

### Confinement and network

A live agent runs in an empty temporary directory with `--strict-mcp-config`, only `mcp__orchestrai__*` tools allowed, built-in file and shell tools denied, and a bounded turn count. The permission engine remains the real control: an unapproved write reaches nothing.

A live provider **sends the conversation and project state to its model provider** — the first outbound network traffic in this project. The connection screen says so before the session is connected. The runtime child receives a deliberate environment allowlist (`PATH`, `HOME`, `USER`, and a few more) rather than the whole environment, so unrelated secrets in a desktop session are not inherited by an agent process. `USER` is included because macOS keeps CLI credentials in the Keychain and its lookup fails without it.

### What is verified

`pnpm test` covers the channel (token rejection, malformed and oversized messages, and the absence of any approval, adapter, or persistence operation), CLI event parsing, confinement flags, cancellation, failure typing, verification states, and the environment allowlist — all without spending model usage.

`pnpm test:smoke-agent` runs the real thing: it verifies the sign-in, selects Claude Code, connects it alongside the live bridge, lets the model call tools through the permission path, approves the write, and asserts it reached the session. It costs model usage, so it is not part of `pnpm test`, and it skips when the CLI is absent or signed out.

Codex is implemented against the same contract. Its happy path is **unverified here**: the account reached its usage limit during testing, which surfaced as a typed failure naming the CLI's own reason.

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
pnpm test:smoke-bridge
pnpm test:smoke-agent
pnpm audit --prod
```

`pnpm test` builds the runtime entries before exercising unit and real-process integration tests. Coverage includes schema rejection, protocol initialization, SQLite migration rollback/history, CLI discovery, provider contracts, policy bypass attempts, approval replay/expiry/cancellation, persistence failure, and conflicting Undo.

The macOS Electron smoke harness checks actual rendered UI behavior: offline production loading, renderer isolation, chat, approval/cancellation, tempo, transport, Undo, reload, persisted history, a forced crash of its own runtime child, explicit recovery, and child cleanup. It saves screenshots to ignored `artifacts/`. It does not touch real DAWs or user libraries. The crash-injection portion uses macOS/POSIX process inspection and is not a Windows smoke harness.

For development-mode smoke verification, start `pnpm --filter @orchestrai/desktop dev:renderer` in one terminal, then run `node scripts/smoke.mjs --dev` in another after building the desktop entries.

## Next milestones

Sample folders, indexing, preview, and MIDI artifacts remain the next milestone. API credential storage, plugin operations, autonomous Agent mode, and token-level streaming into the transcript remain separate integrations. The active implementation checklist is `openspec/changes/add-cubase-midi-bridge/tasks.md`; Milestone 1 is archived under `openspec/changes/archive/`.
