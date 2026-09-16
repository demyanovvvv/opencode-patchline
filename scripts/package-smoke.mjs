import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const workspace = await mkdtemp(path.join(os.tmpdir(), "patchline-package-smoke-"))
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error("npm_execpath is unavailable; run this smoke test through npm")
let tarball

function runNpm(args, options = {}) {
  return execute(process.execPath, [npmCli, ...args], options)
}

try {
  const { stdout } = await runNpm(["pack", "--json"], { maxBuffer: 5_000_000 })
  const report = JSON.parse(stdout)
  const filename = report[0]?.filename
  if (typeof filename !== "string") throw new Error("npm pack did not report a package filename")
  tarball = path.resolve(filename)
  await runNpm(["init", "-y"], { cwd: workspace })
  await runNpm(["install", "--ignore-scripts", tarball], { cwd: workspace, maxBuffer: 5_000_000 })
  const probe = [
    "const required = { main: { PatchlinePlugin: 'function', EditService: 'function', WriteService: 'function', recoveryActionFor: 'function' }, plugin: { PatchlinePlugin: 'function', default: 'object' }, server: { PatchlinePlugin: 'function', default: 'object' } }",
    "const check = async (specifier, names) => { const module = await import(specifier); for (const [name, type] of Object.entries(names)) if (typeof module[name] !== type) throw new Error(`Missing public export: ${specifier}#${name}`) }",
    "await check('opencode-patchline', required.main)",
    "await check('opencode-patchline/plugin', required.plugin)",
    "await check('opencode-patchline/server', required.server)",
  ].join("\n")
  await execute(process.execPath, ["--input-type=module", "--eval", probe], { cwd: workspace })
  const cli = process.platform === "win32" ? path.join(workspace, "node_modules", ".bin", "opencode-patchline.cmd") : path.join(workspace, "node_modules", ".bin", "opencode-patchline")
  await execute(cli, ["config", "show"], { cwd: workspace, shell: process.platform === "win32" })
  console.log("Package smoke passed (isolated tarball install and public imports)")
} finally {
  if (tarball) await rm(tarball, { force: true })
  await rm(workspace, { recursive: true, force: true })
}
