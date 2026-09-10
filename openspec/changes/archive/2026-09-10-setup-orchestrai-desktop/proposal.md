## Why

Music assistants cannot reliably work with a producer's existing DAW and local assets. OrchestrAI needs an inspectable, local-first foundation that proves the agent → orchestrator → permission engine → normalized tools → DAW adapter architecture before implementing real Cubase control.

## What Changes

- Set up the TypeScript monorepo and secure Electron desktop application with a Next.js App Router interface and Tailwind CSS for all UI styling, preserving Windows portability. Do not use Bootstrap or a Vite renderer.
- Initialize local SQLite storage with migrations, conversation history, tool transactions, and structured diagnostic logs.
- Discover Claude Code, Codex, and the optional OpenAI CLI without executing discovered programs or equating installation with authentication.
- Define a common agent provider interface and OpenAI abstraction; provide an explicitly labeled deterministic demo provider for exercising the skeleton without credentials.
- Start a supervised local MCP server process with typed, validated tools and a shared permission-controlled orchestration path.
- Introduce the DAW adapter contract and a clearly identified mock Cubase adapter with project state, tempo, and play/stop capabilities.
- Build connection setup, basic chat, project/context views, Ask/Assist modes, approval prompts, tool activity, and a developer console.
- Limit this change to PRD Milestone 1. Real provider sessions, API credential connection, the Cubase bridge, sample indexing/preview, MIDI generation, and plugin operations remain subsequent changes.

## Capabilities

### New Capabilities

- `desktop-foundation`: Workspace layout, secure Electron lifecycle, validated IPC, local storage, and recovery.
- `agent-discovery`: Local executable discovery, accurate connection states, provider contracts, and deterministic demo sessions.
- `music-orchestration`: Capability-filtered tool registry, permissions, transactions, and supervised MCP execution.
- `mock-daw-adapter`: DAW-independent contracts and a mock Cubase implementation for exercising supported operations.
- `production-workspace`: Connection screen, chat/history, project context, tool activity, approvals, and diagnostics.

### Modified Capabilities

None. The repository has no existing application or capability specifications.

## Impact

Introduces `apps/desktop` and packages for shared types, agent core, CLI discovery, OpenAI/Claude provider boundaries, orchestrator, MCP server, and Cubase adapter. Reserved music-engine, sample-indexer, and audio-analysis packages document later ownership without implementing future features. Adds Electron, Next.js, React, Tailwind CSS, a SQLite driver, an MCP SDK, Zod, and TypeScript/lint/format/test tooling; dependency versions will be selected and verified during implementation. Next.js exports the renderer for offline desktop use; privileged services remain behind Electron IPC. Local application data is stored under the OS application-data directory. No real DAW, agent account, or sample library is modified, and this milestone requires no cloud calls.
