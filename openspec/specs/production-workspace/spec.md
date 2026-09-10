# production-workspace Specification

## Purpose

TBD - created by archiving change setup-orchestrai-desktop. Update Purpose after archive.

## Requirements

### Requirement: Honest connection setup

The connection screen SHALL offer Cubase 14 Mock, refreshable agent discovery, an explicitly selectable Demo agent, and clear unavailable labels for future DAWs, live provider sessions, and sample-library features.

#### Scenario: First launch without external installations

- **WHEN** the application starts with no Cubase or agent CLI installed
- **THEN** the user can connect Mock plus Demo and enter the workspace without credentials

### Requirement: Production chat and context

The dark desktop workspace SHALL use Next.js with TypeScript and Tailwind CSS for all UI styling, including layout, typography, colors, responsive behavior, and interaction states. It SHALL display project tracks, project context, provider/DAW status, chat, a composer, and Ask/Assist controls. Each track SHALL show its name, level as the reported fader position, and its mute and solo state, and a session reporting no channels SHALL be presented as having no tracks rather than as a failure to read them. Messages SHALL persist locally and conversations SHALL be reopenable. Demo responses SHALL always be identified as Demo.

#### Scenario: Reopen conversation

- **WHEN** the user selects a saved conversation after restart
- **THEN** prior messages and associated recorded activity appear without re-executing tools

#### Scenario: Live session with tracks

- **WHEN** a session with channels is connected
- **THEN** each track is listed with its name, level, and mute or solo state

#### Scenario: Empty session

- **WHEN** a connected session reports no channels
- **THEN** the interface says the session has no tracks yet

### Requirement: Visible tool and approval activity

Every operation SHALL appear with its tool, target/arguments, initiating agent, and status. Pending writes SHALL expose keyboard-accessible Approve and Cancel controls, remain discoverable across conversation navigation, and display terminal errors or results.

#### Scenario: Approve tempo from chat

- **WHEN** Demo proposes 124 BPM in Assist
- **THEN** an approval card displays the exact change, state stays unchanged until approval, and success updates tempo context and activity

#### Scenario: Cancel tempo from chat

- **WHEN** the user cancels the proposal
- **THEN** the card shows cancellation and displayed project tempo remains unchanged

### Requirement: Transport and undo follow policy

Workspace transport and Undo controls SHALL invoke normalized operations through the same permission engine, disable unavailable actions, and expose only actually reversible operations.

#### Scenario: Ask transport

- **WHEN** Ask mode is active
- **THEN** transport writes are disabled in the interface and remain rejected by the runtime if invoked directly

### Requirement: Inspectable failures and recovery

The workspace SHALL include a developer console with correlated structured diagnostics, renderer error boundaries, visible process disconnection, and controlled restart/reload actions.

#### Scenario: Runtime becomes unavailable

- **WHEN** the runtime crashes
- **THEN** the workspace displays the error, disables writes, preserves saved history, and offers restart without claiming a connected DAW

### Requirement: Bridge connection setup

Connection setup SHALL let the user choose the Cubase bridge, SHALL list detected MIDI ports, and SHALL report handshake progress, the connected Cubase version, and failure reasons. When no MIDI backend is available the bridge option SHALL be shown as unavailable with the reason, and SHALL not appear connectable.

#### Scenario: No MIDI backend

- **WHEN** the platform has no MIDI backend available
- **THEN** the bridge option is presented as unavailable with the reason, and the mock remains selectable

#### Scenario: Handshake succeeds

- **WHEN** the bridge handshake completes
- **THEN** the interface shows the connected Cubase version and a live, non-mock session indicator

#### Scenario: Bridge lost mid-session

- **WHEN** the bridge disconnects while the workspace is open
- **THEN** writes are disabled, pending approvals are invalidated, history is preserved, and reconnection is an explicit action

### Requirement: Creative partner selection

Connection setup SHALL let the user choose Demo, Claude Code, or Codex, SHALL show installed, authenticated, and connected states per provider, SHALL offer verification, and SHALL explain why an unusable provider cannot be selected.

#### Scenario: Unauthenticated provider

- **WHEN** a discovered CLI is not signed in
- **THEN** it is shown as installed but not connectable, with the reason and the command that signs in

#### Scenario: Network disclosure before connecting

- **WHEN** a live provider is selected
- **THEN** the interface states that conversation content is sent to a model provider before the session is connected, and Demo remains the default

### Requirement: Live agent failure is recoverable

When a live agent session fails, the interface SHALL surface the reason, preserve history, keep the DAW session untouched, and require an explicit retry.

#### Scenario: Agent crashes mid-conversation

- **WHEN** the live CLI exits unexpectedly
- **THEN** the failure and its reason are shown, prior messages remain, and no automatic retry occurs

### Requirement: Sample library management

The interface SHALL let the producer add and remove sample folders, and SHALL show each root's path, sample count, last index time, indexing progress, and any per-root failure without blocking use of the rest of the library.

#### Scenario: Indexing a large folder

- **WHEN** a large folder is being indexed
- **THEN** progress is visible and the interface stays usable

#### Scenario: One root fails

- **WHEN** one root cannot be read
- **THEN** its failure is shown and other roots remain searchable

### Requirement: Sample search and preview

The workspace SHALL let the producer search indexed samples and preview a result, with distinct empty-result and no-library-added states.

#### Scenario: Preview a result

- **WHEN** the producer previews a search result
- **THEN** the audio plays from the local file without being copied or uploaded

### Requirement: Generated clips in the workspace

The workspace SHALL list generated clips with their musical summary, bar count, and creation time, SHALL allow revealing one in the file manager, and SHALL allow dragging one into the DAW.

#### Scenario: A clip appears after approval

- **WHEN** a clip generation is approved
- **THEN** the artifact appears in the workspace with its key, progression, and bars

#### Scenario: No clips yet

- **WHEN** no clip has been generated
- **THEN** the workspace explains that generated clips will appear there, rather than showing an empty list
