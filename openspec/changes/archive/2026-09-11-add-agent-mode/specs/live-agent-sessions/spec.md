## MODIFIED Requirements

### Requirement: Live provider sessions

A live provider SHALL run its CLI non-interactively, parse its event stream into assistant output and tool activity, bound the number of turns, and return typed failures for unauthenticated, missing, crashed, timed-out, or unparseable CLI behavior. Unknown events SHALL be ignored rather than aborting a session. During an autonomous run the provider SHALL be told which tools it may use without approval, which still require it, and what remains of the run's budget.

#### Scenario: Live answer with a tool call

- **WHEN** a live agent answers a request that needs project state
- **THEN** its tool call and its answer appear in the transcript attributed to that provider

#### Scenario: CLI fails mid-turn

- **WHEN** the CLI exits unexpectedly during a turn
- **THEN** the turn fails with the reason, history is preserved, and retrying is an explicit action

#### Scenario: Told the limits of a run

- **WHEN** a turn runs inside an autonomous run
- **THEN** the agent is told what it may do without asking and what remains of the budget
