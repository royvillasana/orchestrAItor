## MODIFIED Requirements

### Requirement: Bound approval lifecycle

Every write SHALL bind its arguments, session, and agent to a single approval that expires, is consumed once, and is invalidated by cancellation, mode change, disconnect, or restart. A write addressing a single track SHALL bind the track it names, so an approval cannot be applied to a different track.

#### Scenario: Approval names its track

- **WHEN** a track volume change is approved
- **THEN** the change is applied to the track the request named and to no other

#### Scenario: Track disappears before execution

- **WHEN** an approved track write executes after that track is no longer reported
- **THEN** execution is refused and the outcome is recorded as failed
