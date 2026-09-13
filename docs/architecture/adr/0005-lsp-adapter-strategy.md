# ADR 0005: LSP Adapter Strategy

## Decision

Prefer the native OpenCode LSP tool when the experimental capability is
enabled. Do not eagerly start separate language servers. Grep and AST are
deterministic fallbacks, not semantic substitutes.

## Consequences

The initial package does not duplicate OpenCode's LSP process manager. Doctor
reports whether native model-facing LSP is enabled.
