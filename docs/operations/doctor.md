# Doctor

`opencode-patchline doctor` checks Node.js, OpenCode, plugin SDK, Hashline,
ast-grep, filesystem round trips, stale rejection prerequisites, CRLF, BOM,
native LSP flags, and a TypeScript LSP setup check. On Node.js, the Bun-native
upstream Hashline adapter is an optional capability; exact snapshot edits remain
available. The check distinguishes the Node fallback from the full Bun/native
Hashline runtime. It does not modify OpenCode configuration.

For a release archive, invoke the adjacent CLI with Node.js:

```bash
node /path/to/package/dist/cli.js doctor
node /path/to/package/dist/cli.js doctor --lsp --directory /work/project --json
node /path/to/package/dist/cli.js lsp check --directory /work/project --json
node /path/to/package/dist/cli.js lsp setup --directory /work/project
```

`doctor --lsp` and `lsp check` inspect language roots and server availability
without installing packages. They report preparation, not a verified connection.
`lsp setup` explicitly prepares managed servers where supported. OpenCode-managed
servers and installed toolchains remain in use; disabled/custom configuration is
preserved. Managed npm servers use pinned recipes and a dedicated cache rather
than editing the project's package manifest or installing globally.

`patchline_lsp_status` shows project preparation and connection state in the agent
session, with a conversation card in the integrated TUI. `patchline_lsp` performs
queries and connection checks. Prepared, installed or configured does not prove
a successful handshake. Missing toolchains must be installed using their normal
language-specific installation method.

Managed storage is `%LOCALAPPDATA%/opencode-patchline/lsp` on Windows and
`$XDG_DATA_HOME/opencode-patchline/lsp` (default `~/.local/share/...`) elsewhere.
It is independent of installer-owned TypeScript/Bun dependencies and retained
on plugin removal. Restart OpenCode after changing plugin/configuration options.
