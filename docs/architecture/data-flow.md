# Data Flow

Status: Accepted

## Read

`validate path -> read raw bytes -> decode -> snapshot -> select range -> render anchors`

## Edit

`validate scope -> load snapshot -> compare raw digest -> prepare in memory -> atomic replace -> invalidate -> diagnose`

## Multi-file edit

`validate all scopes -> validate all snapshots -> prepare all candidates -> preflight all writes -> commit with rollback data`

No source write occurs before path, scope, snapshot, and patch validation.
Existing-file replacements use a temporary file in the target directory followed by
an atomic entry replacement. Target and parent identities are rechecked before
temporary-file creation and again before rename; a swapped target or parent is
rejected and never followed. New-file creation remains exclusive (`wx`).
