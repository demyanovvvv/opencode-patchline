# Security Policy

Patchline treats the current working tree as authoritative and refuses stale
or out-of-workspace edits. Please report security issues privately to the
repository maintainers rather than opening a public issue with an exploitable
payload.

Security-sensitive behavior includes path resolution, symlink handling,
existing-file write guards, patch parsing, and multi-file commit recovery.
