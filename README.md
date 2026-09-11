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

The creative partner can be switched from the workspace header without leaving the session; the DAW connection is untouched, and a switch is refused while a turn is still running. The chat surface shows what a turn is actually doing: a shimmer placeholder until the first token, the reply streaming in as the CLI emits it, tool calls as chips beside the message that caused them, a failure with its reason and a retry, and a Stop control while the turn runs. Streaming is display state only — the message is still persisted once, when the turn ends — so a crash mid-turn cannot leave half a reply in history. The composer carries an animated border (`border-beam`), lit at rest so the input reads as the AI surface and brighter while a turn runs. It stops when the window is not on screen and never animates for someone who set `prefers-reduced-motion` — a continuously animating glow is not free, and this is an audio application.

Agent replies are rendered from a small Markdown subset — emphasis, inline code, fenced code, headings, and lists — built as React nodes. Model output is untrusted text, so nothing is ever injected as HTML.

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

### Tracks

A connected session reports its channels — name, level, mute, solo — read from Cubase's own callbacks rather than from what the driver script last wrote, so a fader moved by hand in Cubase is reflected rather than overwritten. `track.set_volume`, `track.set_mute`, and `track.set_solo` address one track by id, take the same approval as any other write, and are refused before anything is sent if the named track is not in the reported state.

**Volume is the fader position, 0 to 1, not decibels.** Converting would mean reproducing Steinberg's fader taper, which this project would be guessing at, and a wrong decibel figure reads as authoritative in a way an honest normalized one does not. The interface shows a percentage; Cubase shows the decibels, correctly.

The bank covers the first 16 channels of audio, instrument, MIDI, group, and FX kinds. A larger session is reported as truncated rather than as though the list were the whole project. Creating, renaming, and reordering tracks, sends, inserts, EQ, and automation remain out of scope.

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

Both providers are verified against the same workflow: `ORCHESTRA_AGENT=codex pnpm test:smoke-agent` runs it against Codex, and the default runs it against Claude Code.

Two Codex specifics, both of them its own behaviour rather than ours. Its event stream has shipped two shapes — older builds wrap the payload in `msg` with a `message` field, current builds report `item.completed` carrying an `item` with `text` — and both are parsed, since the installed CLI belongs to the producer. And `codex exec` asks its own approval before calling a tool, which cannot be answered in a non-interactive turn; without `--approve-for-me` every tool call fails as "approval required". Its sandbox is scoped to the working directory, which is the empty temporary one created for that turn, and OrchestrAI's permission engine remains what guards the DAW.

## Sample libraries

Add a folder in the connection screen and OrchestrAI indexes it locally. Nothing is copied, moved, or uploaded: the index records paths, sizes, modification times, tags derived from folder and file names, and the format facts readable from a header.

```sh
pnpm test:smoke-samples <folder>   # index, search, and preview a real folder
```

- **Bounded**: each root is walked to a depth of 12 and a cap of 50,000 files, hidden directories skipped, and a symlink may not carry indexing outside the chosen folder. Hitting the cap is reported as `truncated`, not silently swallowed.
- **Header facts, not decoding**: WAV and AIFF give sample rate, channels, bit depth, and duration from their headers. Other formats are indexed by name, size, and tags with those facts recorded as **unknown** — an invented duration is worse than an absent one.
- **Incremental**: re-indexing skips files whose path, size, and modification time are unchanged, and reports added, updated, removed, and skipped counts.
- **Derived tags**: tokens from the path, so anything under a folder called `808` is tagged `808`. That is name matching, not analysis; audio analysis remains a later capability.

`samples.search` and `samples.stats` are registered as **read-only** tools available in Ask, and they do not need a DAW connection — so a live agent can find sounds with no session open, and neither tool can change anything.

Preview plays through `orchestra-sample://`, a second protocol confined to the index: the resolved path of any request must be an indexed file, so a symlink cannot borrow an indexed name to reach something else, and a file the producer never indexed is refused whether or not it exists. The scheme supports media only — no fetch — and CSP admits it under `media-src` alone.

### Estimated key and tempo

`Analyse key & tempo` estimates each WAV or AIFF sample's key and tempo from the audio itself, so search can answer a musical question rather than a filename one. Type a key like `Am` into the sample search box, or ask a live agent for "a kick in A minor near 124".

**These are estimates and are labelled as such**, with a confidence beside them. A key stated with false certainty sends a producer to the wrong sound, which costs more than no key at all. Below 35% confidence an estimate does not answer a musical search — a weak guess is not evidence — though the sample is still findable by name.

- **Key** comes from chroma correlation against major and minor profiles. It confuses relative majors and minors on ambiguous material; the confidence is the margin over the alternatives.
- **Tempo** comes from onset autocorrelation with a prior over musical tempos. Half and double time are inherent to the method; material with no attacks — a pad, noise, a one-shot — reports no tempo rather than a number pulled out of its own noise floor.
- **Compressed formats are not analysed.** Doing it honestly needs a real codec, and estimating from a partial decode produces errors nobody can account for. Those samples stay searchable by name and header facts.
- **Analysis is separate from indexing**, because it decodes audio and indexing does not. It runs in the background, is stoppable, skips what it has already done, and persists across restarts. Measured here: 10 samples in about 12 seconds. A large library will take real time on a machine that may also be running a DAW.

**What leaves the machine**: audio never does. When a live partner is connected, search results it asks for — file names, folder names, and header facts — are sent to that model provider along with the rest of the conversation, which is what the connection screen already discloses.

## Generated clips (MIDI artifacts)

Ask for a chord progression, bassline, or drum pattern and the agent generates a real standard MIDI file in the session's key and tempo. Clips appear in the workspace with their musical summary; drag one onto a Cubase track, or reveal it in Finder.

**A clip is a file, not an insertion.** Cubase's MIDI Remote API controls a surface — it cannot create parts in a project — so the honest hand-off is a file you drop in, and the interface says exactly that rather than implying your session changed.

- **Theory, not tables**: chords come from scale degrees and roman numerals, so a progression is correct in whatever key the session reports and can be described back as `i · VI · III · VII in A minor`. Voicings stay in a playable register.
- **Deterministic**: every generator is pure and seeded, the seed is recorded with the artifact, and the same request reproduces the same file. "Give me another one" and "give me that one again" are different requests.
- **No dependency**: the MIDI writer emits bytes directly — header and track chunks, variable-length delta times, tempo and time-signature meta events. It is verified by parsing files back and by `file(1)` identifying them as `Standard MIDI data (format 0)`.
- **An approved write**: `midi.create_clip` is refused in Ask and requires approval in Assist like any other write. Nothing is written before you approve. Because a file is not session state, there is nothing to undo into the DAW, and the activity says so instead of offering a restore that would do nothing.

Clips live under `artifacts/` in the application data directory, never in your project or sample folders, and generation never overwrites: a repeated request produces a second clip beside the first.

## Agent mode

Ask reads. Assist approves every write. **Agent mode** runs a bounded sequence of changes without a prompt for each one — for iterating, where approving every step is the whole interaction.

It is the only path where the session changes without a prompt immediately before the change, so the guarantee moves elsewhere:

- **A run, not a setting.** Agent mode is entered deliberately and a run is started explicitly with its budget. Nothing persists across restarts: a mode whose purpose is acting without asking is the one nobody should find already switched on.
- **The budget is the bound.** A run declares how many changes it may make and how long it may take. Both are checked _before_ each write, and exhausting either ends the run with the reason. "Eight changes, two minutes" is a sentence with a worst case.
- **A standing list, not a blanket.** Only tempo, transport, and track volume/mute/solo run without asking. Anything else — clip generation, anything new — still takes an approval, in Agent mode exactly as in Assist, and a capability classified destructive is never on the list.
- **Stop means now.** Stop is checked before each write, so it never costs one more operation.
- **The run is the unit of undo.** A run captures the session before it starts and offers a single undo restoring it, under the same revision check as any other undo. Undoing writes one at a time would ask a producer to reason about ordering they never watched.
- **A failure ends the run**, rather than continuing against a session whose state is no longer known while nobody is watching.

A live agent is told what it may do without asking and what remains of the budget, so it does not discover the limits by hitting them.

`pnpm test:smoke-agent-mode` runs it against a live agent and the bridge: a bounded run, changes with no prompts, a stop, and a run undo. It costs model usage, so it is not part of `pnpm test`.

## Local data and recovery

Data lives in Electron's OS application-data directory under `OrchestrAI`:

- macOS: `~/Library/Application Support/OrchestrAI/`
- Windows: `%APPDATA%/OrchestrAI/`
- `orchestrai.sqlite`: settings, conversations, messages, tool calls, transactions, sample roots and index, generated clips, and migration versions (schema 3).
- `artifacts/`: generated MIDI clips, one file per clip.
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
pnpm test:smoke-agent-mode
pnpm test:smoke-samples <folder>
pnpm audit --prod
```

`pnpm test` builds the runtime entries before exercising unit and real-process integration tests. Coverage includes schema rejection, protocol initialization, SQLite migration rollback/history, CLI discovery, provider contracts, policy bypass attempts, approval replay/expiry/cancellation, persistence failure, and conflicting Undo.

The macOS Electron smoke harness checks actual rendered UI behavior: offline production loading, renderer isolation, chat, approval/cancellation, tempo, transport, Undo, reload, persisted history, a forced crash of its own runtime child, explicit recovery, and child cleanup. It saves screenshots to ignored `artifacts/`. It does not touch real DAWs or user libraries. The crash-injection portion uses macOS/POSIX process inspection and is not a Windows smoke harness.

For development-mode smoke verification, start `pnpm --filter @orchestrai/desktop dev:renderer` in one terminal, then run `node scripts/smoke.mjs --dev` in another after building the desktop entries.

## Next milestones

API credential storage, plugin operations, and token-level streaming into the transcript remain separate integrations. The active implementation checklist is `openspec/changes/add-cubase-midi-bridge/tasks.md`; Milestone 1 is archived under `openspec/changes/archive/`.
