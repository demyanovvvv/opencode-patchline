import assert from "node:assert/strict"
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { resolveInstalledOpenCode } from "../dist/installer.js"
import { createSmokeEnvironment } from "./smoke-environment.mjs"

const execute = promisify(execFile)
const root = await mkdtemp(path.join(os.tmpdir(), "patchline-flags-smoke-"))
const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const cli = path.join(packageRoot, "dist", "cli.js")
try {
  const bin = path.join(root, "bin")
  const project = path.join(root, "project with spaces")
  const config = path.join(root, "config", "opencode")
  await Promise.all([mkdir(bin), mkdir(project), mkdir(config, { recursive: true })])
  const binary = path.join(bin, process.platform === "win32" ? "opencode.exe" : "opencode")
  await copyFile(await resolveInstalledOpenCode(), binary)
  const env = createSmokeEnvironment(root)
  const inheritedPath = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? ""
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key]
  env.PATH = `${bin}${path.delimiter}${inheritedPath}`
  const options = { cwd: root, env, windowsHide: true, timeout: 120_000, maxBuffer: 5_000_000 }
  const run = (args) => execute(process.execPath, [cli, ...args], options)
  const wrapper = (action, args) => process.platform === "win32"
    ? execute("pwsh", ["-NoProfile", "-File", path.join(packageRoot, `${action}.ps1`), ...args], options)
    : execute("sh", [path.join(packageRoot, `${action}.sh`), ...args], options)
  for (const scope of ["--project", "--global"]) {
    const target = scope === "--project" ? project : config
    await writeFile(path.join(target, "opencode.json"), '{"plugin":["unrelated"]}\n')
    await writeFile(path.join(target, "tui.json"), '{"plugin":["unrelated-tui"]}\n')
    const common = [scope, "--cwd", project, "--lang=ru"]
    const before = await readdir(target)
    const preview = await wrapper("install", [...common, "--dry-run", "--no-host", "--no-lsp"])
    assert.match(preview.stdout, /opencode-patchline/)
    assert.deepEqual(await readdir(target), before)
    await wrapper("install", [...common, "--no-host", "--no-lsp"])
    const state = JSON.parse(await readFile(path.join(target, ".opencode-patchline-state.json"), "utf8"))
    assert.equal(state.scope, scope === "--project" ? "project" : "global")
    assert.equal(state.language, "ru")
    assert.deepEqual(state.lspPackages, [])
    assert.deepEqual(state.addonPackages, [])
    const installed = await readFile(path.join(target, "opencode.json"), "utf8")
    await run(["uninstall", ...common, "--dry-run", "--keep-deps"])
    assert.equal(await readFile(path.join(target, "opencode.json"), "utf8"), installed)
    await wrapper("uninstall", [...common, "--keep-deps", "--yes"])
    assert.deepEqual(JSON.parse(await readFile(path.join(target, "opencode.json"), "utf8")).plugin, ["unrelated"])
    await assert.rejects(readFile(path.join(target, ".opencode-patchline-state.json")), { code: "ENOENT" })
  }
  const help = await wrapper("uninstall", ["--help", "--lang=ru"])
  assert.match(help.stdout, /--restore-host/)
  console.log("Installer flags smoke passed: project/global wrappers, cwd, read-only preview, component flags and removal")
} finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
