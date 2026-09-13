# Compatibility Specification

Status: Accepted

Patchline targets OpenCode `1.18.x`, Node.js 20 or newer, and the public v1
plugin API. Capability detection is mandatory: unavailable native LSP or AST
bindings disable only the affected feature. A changed plugin tool ordering,
missing execution hook, or unavailable session/worktree identity is a hard
compatibility failure for precision mode.

Current verified dependencies are `@opencode-ai/plugin@1.18.30` and
`@oh-my-pi/hashline@18.1.5`. Hashline is loaded lazily because its published
runtime targets Bun; Node-only installations retain exact anchored edits and
report Hashline availability through doctor.
