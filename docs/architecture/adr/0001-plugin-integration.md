# ADR 0001: OpenCode Plugin Integration

## Context

OpenCode 1.18.30 appends plugin tools after built-ins and creates the final
model tool map by ID.

## Decision

Publish the v1 package entrypoint and override `read`, `edit`, and `write` with
same-ID guarded tools. Use execution hooks to guard fallback `apply_patch` and
unsafe whole-file shell writes.

## Consequences

The normal OpenCode UX is preserved. Compatibility must be revalidated when
the tool registry ordering or plugin loader changes.
