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
    "import('opencode-patchline').then((module) => {",
    "  for (const name of ['PatchlinePlugin', 'EditService', 'WriteService']) {",
    "    if (typeof module[name] !== 'function') throw new Error(`Missing public export: ${name}`)",
    "  }",
    "})",
  ].join("\n")
  await execute(process.execPath, ["--input-type=module", "--eval", probe], { cwd: workspace })
  console.log("Package smoke passed (isolated tarball install and public imports)")
} finally {
  if (tarball) await rm(tarball, { force: true })
  await rm(workspace, { recursive: true, force: true })
}
