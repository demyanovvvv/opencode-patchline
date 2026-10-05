#!/bin/sh
set -eu

# Prefer local build if running from source checkout
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)"
if [ -f "$SCRIPT_DIR/src/cli.ts" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
  PKG_NAME=$(node -e "try{const p=require('$SCRIPT_DIR/package.json');console.log(p.name||'')}catch(e){}" 2>/dev/null || true)
  if [ "$PKG_NAME" = "opencode-patchline" ]; then
    if ! command -v node >/dev/null 2>&1; then
      printf '%s\n' 'Node.js >=20 is required. Install Node.js and retry.' >&2
      exit 1
    fi
    if [ ! -f "$SCRIPT_DIR/dist/cli.js" ]; then
      printf '%s\n' "Build the source checkout first: run npm install and npm run build in '$SCRIPT_DIR', then retry." >&2
      exit 1
    fi
    exec node "$SCRIPT_DIR/dist/cli.js" uninstall "$@"
  fi
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  printf '%s\n' 'Node.js >=20 and npx are required. Install Node.js and retry.' >&2
  exit 1
fi
exec npx --yes opencode-patchline@latest uninstall "$@"