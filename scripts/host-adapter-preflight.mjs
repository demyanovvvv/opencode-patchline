import { readFile } from "node:fs/promises"
import path from "node:path"
import { prepareHostSourceChanges, patchHostUpgradeCommand, patchHostTuiUpdate } from "../dist/installer.js"
const root = process.argv[2]
if (!root) throw new Error("Specify an upstream OpenCode checkout")
const files = { renderer: "packages/tui/src/routes/session/index.tsx", registry: "packages/opencode/src/tool/registry.ts", upgrade: "packages/opencode/src/installation/index.ts", startup: "packages/opencode/src/cli/upgrade.ts" }
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(path.join(root, file), "utf8")])))
prepareHostSourceChanges(source, path.resolve("dist/cli.js"))
patchHostUpgradeCommand(await readFile(path.join(root, "packages/opencode/src/cli/cmd/upgrade.ts"), "utf8"))
patchHostTuiUpdate(await readFile(path.join(root, "packages/opencode/src/cli/cmd/tui.ts"), "utf8"))
console.log("Upstream host adapter preflight passed")
