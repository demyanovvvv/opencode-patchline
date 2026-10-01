# Patchline Documentation

Patchline is a precision editing engine for OpenCode.

- [Russian user guide](../README.ru.md)
- [English user guide](../README.md)

## Start here

- [Architecture](architecture/overview.md)
- [Runtime integration](architecture/runtime-integration.md)
- [Compatibility](specs/compatibility.md)
- [Tool contracts](specs/tool-contracts.md)
- [Editing rules](rules/editing-rules.md)
- [Testing strategy](testing/test-strategy.md)
- [Installation](operations/installation.md)
- [Uninstallation](operations/uninstallation.md)
- [Development progress](development-progress.md)
- [Selected agent skills](skills/selected-skills.md)

Documents in `specs/` are normative runtime contracts. Documents in `rules/`
define engineering and model-facing policy. Architecture decision records in
`architecture/adr/` explain accepted tradeoffs.

## Priority order

1. Preserve user code.
2. Preserve the current working-tree state.
3. Reject stale edits.
4. Apply the smallest correct diff.
5. Understand relationships correctly.
6. Minimize context and tool output.
7. Optimize speed.
