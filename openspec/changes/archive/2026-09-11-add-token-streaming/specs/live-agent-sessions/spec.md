## MODIFIED Requirements

### Requirement: Live provider sessions

A live provider SHALL run its CLI non-interactively, parse its event stream into assistant output and tool activity, bound the number of turns, and return typed failures for unauthenticated, missing, crashed, timed-out, or unparseable CLI behavior. Unknown events SHALL be ignored rather than aborting a session. Where the CLI supports it, assistant text SHALL be reported as it is produced rather than only when a block completes, and the provider SHALL assemble the running text so consumers do not depend on how a given CLI divides its output. During an autonomous run the provider SHALL be told which tools it may use without approval, which still require it, and what remains of the run's budget.

#### Scenario: Text arrives as it is written

- **WHEN** a live agent produces a long reply on a CLI that streams partial messages
- **THEN** the transcript fills in as it is produced rather than after the reply completes

#### Scenario: A CLI that streams only whole blocks

- **WHEN** a CLI reports completed blocks rather than deltas
- **THEN** the transcript still fills in progressively and nothing is duplicated

#### Scenario: Persistence is unchanged

- **WHEN** a streamed turn completes
- **THEN** the stored message is written once from the completed output, not from the display buffer

#### Scenario: CLI fails mid-turn

- **WHEN** the CLI exits unexpectedly during a turn
- **THEN** the turn fails with the reason, history is preserved, and retrying is an explicit action
