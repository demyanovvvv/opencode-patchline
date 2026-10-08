# LSP Contract

Status: Accepted

SDK symbols responses are inspected for error envelopes. Requests forward abort
signals and have a 15-second deadline; output is bounded to 20,000 characters.
File-specific plugin calls authorize the canonical target before CLI execution.

The fallback order is the active OpenCode SDK symbol client, native OpenCode
LSP, the CLI bridge, AST, then grep. Workspace-symbol requests use the active
SDK client when available, avoiding an isolated process; document symbols and
diagnostics retain the CLI bridge. OpenCode 1.18.30 exposes model-facing LSP
only when `OPENCODE_EXPERIMENTAL_LSP_TOOL` or global experimental mode is enabled.
Patchline does not start a duplicate server in the initial release. Its
optional CLI bridge is exposed as `patchline_lsp` rather than `lsp`, preserving
OpenCode's native experimental tool when that capability is enabled.
When the native tool flag is disabled, Patchline's `lsp` tool bridges
`workspaceSymbol`, `documentSymbol`, and diagnostics through the installed
OpenCode CLI. Definition/reference/call hierarchy remain native-only.

The CLI bridge never invokes a shell. It propagates OpenCode tool cancellation,
has a 120-second execution deadline to allow slow OpenCode LSP startup, and bounds each captured output stream to
200,000 characters so an unhealthy CLI cannot retain unbounded memory. A
successful empty JSON result is accepted for diagnostics. Empty symbol results
are returned as `CAPABILITY_UNAVAILABLE` with an explicit native-LSP/AST/grep
fallback hint, since the isolated CLI request cannot prove that a document or
workspace index has been initialized. Disabled or unconfigured LSP is reported
with the same capability error rather than being misreported as no symbols. The bridge requests OpenCode startup logs at INFO level to make
that distinction observable without changing the user's OpenCode configuration.
Capability errors include the requested `operation`. Disabled/unconfigured LSP
adds `lsp: "disabled"`; empty symbol output adds `indexing: "unverified"`. These
are distinct degraded states and integration checks accept the host's actual
state rather than requiring indexing to be unverified when LSP is disabled.
