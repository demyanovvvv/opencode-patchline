# LSP Contract

Status: Accepted

The fallback order is native OpenCode LSP, existing OpenCode server
integration, AST, then grep. OpenCode 1.18.30 exposes model-facing LSP only
when `OPENCODE_EXPERIMENTAL_LSP_TOOL` or global experimental mode is enabled.
Patchline does not start a duplicate server in the initial release. Its
optional CLI bridge is exposed as `patchline_lsp` rather than `lsp`, preserving
OpenCode's native experimental tool when that capability is enabled.
When the native tool flag is disabled, Patchline's `lsp` tool bridges
`workspaceSymbol`, `documentSymbol`, and diagnostics through the installed
OpenCode CLI. Definition/reference/call hierarchy remain native-only.

The CLI bridge never invokes a shell. It propagates OpenCode tool cancellation,
has a 30-second execution deadline, and bounds each captured output stream to
200,000 characters so an unhealthy CLI cannot retain unbounded memory.
