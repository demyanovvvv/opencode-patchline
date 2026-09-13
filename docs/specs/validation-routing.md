# Validation Routing

Status: Accepted

Level 1 performs snapshot and syntax checks. Level 2 selects a changed-file
lint, typecheck, or targeted test command. Level 3 runs affected package tests
or build for larger tasks. Project-wide suites are not run after every local
edit.
