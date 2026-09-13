# ADR 0003: Existing-File Write Guard

## Decision

`write` may create a new file but must reject an existing source file. Complete
replacement requires an explicit allowlist and remains subject to path and
snapshot checks.

## Consequences

Local changes cannot bypass precision editing through full-file replacement.
Generated artifacts should be produced by canonical generators.
