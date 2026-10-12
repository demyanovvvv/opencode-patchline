import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { executeCommand } from "../dist/installation/process.js"
import { resolveInstalledOpenCode } from "../dist/installer.js"

const packageRoot = path.resolve(process.argv[2] ?? ".")
const cli = path.join(packageRoot, "dist", "cli.js")
const version = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version
const installed = (await executeCommand(await resolveInstalledOpenCode(), ["--version"], packageRoot)).output
const before = JSON.parse(await readFile(path.join(fileURLToPath(new URL("../", import.meta.url)), "package.json"), "utf8")).version
if (version !== before) throw new Error("Release package version differs from source")
const sha = createHash("sha256").update(await readFile(path.join(packageRoot, "package.json"))).digest("hex")
console.log(`Installing release ${version}; current host ${installed}; manifest SHA256 ${sha}`)
const result = await executeCommand(process.execPath, [cli, "install", "--local", "--global", "--yes", "--lang", "ru"], packageRoot, true)
if (result.code !== 0) throw new Error("Release registration failed")
const host = await executeCommand(await resolveInstalledOpenCode(), ["--version"], packageRoot)
if (host.output !== `${installed.split("+")[0]}+patchline.${version}`) throw new Error("Installing plugin changed upstream version")
console.log(`Global release registration verified; upstream preserved: ${host.output}`)
