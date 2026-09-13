# Multi-File Edit Contract

Status: Accepted

All paths, snapshots, operations, and candidate bytes are validated before the
first commit. Duplicate targets are rejected using canonical, platform-aware
path identity. Originals are retained until the
batch completes. A commit error triggers best-effort restoration and reports
both landed and restored files. Rollback compares the current bytes with the
Patchline bytes before restoring; if an external change landed after a commit,
Patchline preserves it and reports the path as a rollback conflict.

Edit-batch rollback also retains the identity of each file after its commit and
requires both that identity and the committed bytes to match before restoring
the original. A same-byte replacement is preserved and reported as a conflict.

Create batches use the same guard. Before removing a partially created file,
Patchline re-resolves its canonical identity and compares its current bytes
with the bytes written by Patchline. External replacement, symlink swaps, and
content changes are preserved and reported in `details.conflicts`.

Create-batch rollback also retains the created file identity and requires both
identity and digest to match before removing a partially created file. A
same-byte replacement is therefore preserved as an external conflict.

Creation bookkeeping obtains those bytes and identity from the exclusive `wx`
file handle before path-based rollback checks, so a replacement immediately
after creation cannot be mistaken for the Patchline-created file. Bytes are
read positionally from offset zero on that handle after writing, ensuring an
unchanged partial creation is recognized and removed during rollback.

Existing-file commits and rollback restores write a temporary file in the target
directory and atomically replace the target entry. This prevents a target
symlink swapped after the final identity check from redirecting Patchline bytes:
the operation rejects the swap and never follows it. New-file creation remains
exclusive and never replaces an entry that appeared after preflight.

Atomic replacement retains the parent directory identity from preflight and
checks it before temporary-file creation and before the final rename. A parent
directory replacement therefore rejects the write instead of redirecting it.

New-file creation re-resolves the target after recursive parent creation and
before the exclusive `wx` open. A parent-directory symlink or canonical target
change detected in that interval is rejected; the same guard applies to single
`write` creation and create batches.

File snapshots created by `read` also retain the platform file identity. Edit
commit rejects a target that was replaced by another file even when its bytes
still match the snapshot. The snapshot recorded after a successful edit tracks
the new identity obtained from the temporary file before atomic replacement.
It does not infer that identity from the target path after commit, so a
same-byte replacement in that interval cannot receive a trusted next snapshot
or be mistaken for the Patchline-written file during batch rollback.
