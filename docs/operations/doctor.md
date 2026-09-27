# Doctor

`opencode-patchline doctor` checks Node.js, OpenCode, plugin SDK, Hashline,
ast-grep, filesystem round trips, stale rejection prerequisites, CRLF, BOM,
native LSP flags, and a TypeScript LSP setup check. On Node.js, the Bun-native
upstream Hashline adapter is an optional capability; exact snapshot edits remain
available. It does not modify OpenCode configuration.

Use `opencode-patchline doctor --lsp` or `opencode-patchline lsp check` for an
interactive setup guide. Add `--json` to receive the guide and the suggested
OpenCode configuration as structured data. The guide never edits configuration
or installs dependencies automatically.
