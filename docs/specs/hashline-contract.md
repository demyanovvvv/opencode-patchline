# Hashline Contract

Status: Accepted

`patchline_apply_patch` uses the current `@oh-my-pi/hashline` section format for
existing files. Ordinary OpenCode `apply_patch` retains its classic patch format:

```text
[path/to/file.ts#TAG]
PUT 12.=12:
+replacement line
```

`TAG` is the four-hex content fingerprint shown by `read`. The full Patchline
snapshot ID is also accepted by the `edit` tool. A short tag is resolved only
when it identifies exactly one recorded content version; tag collisions fail
closed and require the full snapshot ID or a fresh read.

All edits are strict by default. Patchline checks session, worktree, canonical
path, snapshot digest, file identity, and parent identity before writing. When
`hashlineRecovery` is enabled, ordinary Hashline edits may use upstream recovery
against live normalized content, but only when every anchored line maps
unambiguously; changed or ambiguous anchors still fail closed. `REM` and `MV`
never use recovery.

The Bun runtime applies the upstream whole-patch semantics, including line
ranges, insertions, structural blocks (`N*`), anonymous and named clipboard
registers, same-path section merging, and file operations (`REM`, `MV`). Named
registers persist only within the session/worktree clipboard scope and failed
batches do not publish tentative register state. Hashline mutations in one
session/worktree are serialized so concurrent calls observe and publish clipboard
state in order. Node retains the bounded linear
`PUT`/`CUT` fallback and rejects unsupported structural, clipboard, and file
operations rather than applying them heuristically. If live content drifted,
the Node fallback rejects with `STALE_SNAPSHOT`; it never writes the old
snapshot over external changes. OpenCode's Bun process is the full runtime.

Every multi-operation patch is parsed and preflighted in memory before the
guarded commit. Overlapping ranges, unseen lines, malformed headers, mismatched
paths, and mismatched tags produce a zero-write error. `REM` and `MV` use guarded
rename/link operations with parent, identity, digest, destination, and rollback
checks; a later failure reports landed writes and preserved conflicts.

The snapshot store indexes exact IDs and tag candidates independently. Multiple
reads of byte-identical content merge their displayed line provenance; distinct
contents remain separate even when their short tags collide.
