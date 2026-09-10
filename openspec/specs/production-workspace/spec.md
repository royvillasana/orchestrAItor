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

The dark desktop workspace SHALL use Next.js with TypeScript and Tailwind CSS for all UI styling, including layout, typography, colors, responsive behavior, and interaction states. It SHALL display project tracks, project context, provider/DAW status, chat, a composer, and Ask/Assist controls. Messages SHALL persist locally and conversations SHALL be reopenable. Demo responses SHALL always be identified as Demo.

#### Scenario: Reopen conversation

- **WHEN** the user selects a saved conversation after restart
- **THEN** prior messages and associated recorded activity appear without re-executing tools

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
