#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
NODE_DIR="$SCRIPT_DIR"
if command -v cygpath >/dev/null 2>&1; then NODE_DIR="$(cygpath -m "$SCRIPT_DIR")"; fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js >=20 is required. Install Node.js and retry.' >&2
  exit 1
fi
if ! node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'; then
  printf '%s\n' 'Node.js >=20 is required.' >&2
  exit 1
fi
if [ ! -f "$SCRIPT_DIR/package.json" ] || [ ! -f "$SCRIPT_DIR/dist/cli.js" ] ||
   ! node -e 'const fs=require("node:fs");try{if(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).name!=="opencode-patchline")process.exit(1)}catch{process.exit(1)}' "$NODE_DIR/package.json"; then
  printf '%s\n' 'Use this script inside an extracted Patchline release package, or build the checkout with npm install and npm run build first.' >&2
  exit 1
fi
for arg in "$@"; do
  case "$arg" in --local|--package|--package=*) exec node "$NODE_DIR/dist/cli.js" install "$@" ;; esac
done
exec node "$NODE_DIR/dist/cli.js" install --local "$@"
