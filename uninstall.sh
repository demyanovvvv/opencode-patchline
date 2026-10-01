#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  printf '%s\n' 'Node.js >=20 and npx are required. Install Node.js and retry.' >&2
  exit 1
fi
exec npx --yes opencode-patchline@latest uninstall "$@"