# ADR 0004: Multi-File Transaction

## Decision

Prepare and preflight every candidate before writing. During commit, retain
original bytes and restore landed files if a later write fails.

## Consequences

Validation failures produce zero writes. Commit rollback is best effort because
portable filesystems do not provide a cross-file atomic primitive.
