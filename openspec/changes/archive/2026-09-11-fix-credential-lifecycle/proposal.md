## Why

An adversarial review of the three closing milestones found defects that the tests written alongside them did not reach. The serious ones share a shape: a credential, a turn, and a session that were treated as independent when they are not.

Removing a key deleted the row and switched the partner, but never stopped the turn already running — so a transport built before the removal kept sending the revoked key to OpenAI, kept writing to the producer's session, and had its answer stored under the Demo agent's name. Replacing a key updated storage and the card's hint while every subsequent request still carried the key it replaced, with no action on that screen able to correct it.

Three smaller ones are of the same kind: a cancelled turn finished the tool calls of the round it was in, a stalled connection could wedge the chat with no deadline, and Agent mode's standing list had quietly grown a plugin write that the interface and the README both said would take approval.

## What Changes

- Resolve the API key per request rather than capturing it, and rebuild or stop the session when the key for the active provider changes.
- Cancel a turn in flight when its key is removed, and attribute an answer to the provider that produced it rather than the one selected when it lands.
- Stop a cancelled turn before the next tool call, and give a turn a deadline so a stalled connection fails instead of hanging.
- Report a cancelled turn as cancelled rather than as an abort error.
- Say what this machine can actually promise about a stored key before one is typed, including a Linux session whose only backend obfuscates rather than encrypts, and refuse to store there.
- Remove `plugin.set_quick_control` from Agent mode's standing list, matching what the interface and the README say, and render the disclosure from the list so the two cannot drift again.
- Restore plugin bypass and quick controls when a run is undone.
- Scope streamed text to the conversation that asked for it, and keep the paragraph breaks of the stored message while a turn is streaming.

Out of scope: retry or backoff for a failed request, a per-provider rate limit, and any change to which providers exist.

## Capabilities

### Modified Capabilities

- **api-credentials**: the lifecycle of a key that changes while a session is using it.
- **live-agent-sessions**: cancellation, deadlines, attribution, and streamed text.
- **music-orchestration**: what Agent mode may do unattended, and what undoing a run restores.
