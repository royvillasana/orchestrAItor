## MODIFIED Requirements

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
