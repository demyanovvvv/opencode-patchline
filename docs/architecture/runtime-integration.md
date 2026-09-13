# OpenCode Runtime Integration

Status: Accepted for OpenCode 1.18.30

Inspection was performed against installed OpenCode `1.18.30`,
`@opencode-ai/plugin@1.18.30`, and the matching `v1.18.30` source tag.

Confirmed integration points:

- `PluginInput` exposes `directory`, `worktree`, `project`, `client`, and shell.
- `ToolContext` exposes `sessionID`, `directory`, `worktree`, abort, metadata,
  and permission prompts.
- plugins may return a `tool` record and execution/system hooks;
- plugin tools are appended after built-ins and the final tool map is keyed by
  ID, so a same-ID plugin tool replaces the built-in model-facing definition;
- `tool.execute.before` runs before every selected tool and a thrown error
  prevents execution;
- built-in LSP is present but model-facing registration is gated by
  `OPENCODE_EXPERIMENTAL_LSP_TOOL` or the global experimental flag;
- current built-ins use IDs `read`, `edit`, `write`, `apply_patch`, and `lsp`.

Patchline therefore overrides `read`, `edit`, and `write`, registers explicit
additional tools, and also overrides `apply_patch`: OpenCode hides `edit` and
`write` for GPT model IDs and selects `apply_patch` instead. The Patchline
version accepts snapshot-tagged Hashline sections. The optional LSP bridge is
published as `patchline_lsp` so it does not mask OpenCode's native experimental
`lsp` tool. Unsafe fallback operations
remain guarded in the before hook. This behavior must be rechecked for each new
OpenCode minor line.
