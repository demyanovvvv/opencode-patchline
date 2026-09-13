# Troubleshooting

`STALE_SNAPSHOT` requires a fresh narrow read. `WRITE_PROTECTED` requires
anchored edit. `PATH_OUTSIDE_WORKSPACE` indicates traversal or symlink escape.
`CAPABILITY_UNAVAILABLE` means the optional provider is disabled; editing
safety remains active. Restart OpenCode after plugin or config changes.
