# Compatibility Specification

Status: Accepted

Patchline targets OpenCode `1.18.x`–`1.19.x`, Node.js 20 or newer, and the public v1
plugin API. Capability detection is mandatory: unavailable native LSP or AST
bindings disable only the affected feature. A changed plugin tool ordering,
missing execution hook, or unavailable session/worktree identity is a hard
compatibility failure for precision mode.

The 1.3.0 release baseline is OpenCode `1.19.0`; its integrated host version is
`1.19.0+patchline.1.3.0`. Current dependencies are `@opencode-ai/plugin@1.19.0` and
`@oh-my-pi/hashline@18.1.5`. Hashline is loaded lazily because its published
runtime targets Bun. Node installations retain exact edits and linear PUT/CUT
Hashline edits through the guarded fallback; structural blocks, registers, and
file operations remain capability-gated and report through doctor.

The integrated conversation host preserves native `apply_patch`, `edit`, and
`write` availability for every model. Its installer recognizes the pinned
upstream model-selection branches, applies an idempotent replacement, and
rejects unknown source shapes before installing a new binary. Stock hosts may
still filter native `apply_patch` by model; restart/rebuild the integrated host
after this migration to enable the fallback for non-GPT models.
The integrated version derives from upstream and package versions without a
private revision suffix. `smoke:host`
copies the installed executable into an isolated PATH and builds/installs there;
the default lifecycle smoke checks registration and removal via command injection.

Tool availability and Patchline policy are provider-neutral: GLM, DeepSeek,
MiniMax, Qwen, Kimi and future tool-capable models receive the same guarded
editing contract. The system hook inserts its exact policy at most once and
includes concrete JSON/exact/Hashline guidance without changing host prompts.
The host smoke verifies native and Patchline tool object schemas for 17
provider/model identifiers spanning direct providers, OpenRouter and OmniRoute.
These are offline registry checks, not provider connectivity or model quality
claims; remote inference and provider-side schema acceptance require configured
credentials and separate API runs. Provider reasoning/schema transformations
remain owned by OpenCode; Patchline does not disable them or weaken guards.
