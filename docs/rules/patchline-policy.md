# Patchline Policy

Locate precisely. Read minimally. Patch exactly. Verify immediately.

The current working tree is authoritative. User changes have priority over Git
HEAD, caches, previous snapshots, and model assumptions. Safety enforcement
belongs in tools; model instructions express strategy only.

Keep ordinary OpenCode apply_patch available for large files, large changes,
and unsupported precision operations. Hashline uses patchline_apply_patch.
External absolute targets require OpenCode directory and operation permissions.
