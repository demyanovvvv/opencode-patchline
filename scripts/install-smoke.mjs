import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createSmokeEnvironment } from "./smoke-environment.mjs"

const execute = promisify(execFile)
const packageDirectory = fileURLToPath(new URL("..", import.meta.url))
const temporary = await mkdtemp(path.join(os.tmpdir(), "patchline-install-smoke-"))
try {
  const configDirectory = path.join(temporary, "config", "opencode")
  await mkdir(configDirectory, { recursive: true })
  let command = "opencode"
  if (process.platform === "win32") {
    command = ""
    for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
      for (const candidate of [path.join(directory, "opencode.exe"), path.join(directory, "node_modules", "opencode-ai", "bin", "opencode.exe")]) {
        try { await access(candidate); command = candidate; break } catch { /* Try the next launcher. */ }
      }
      if (command) break
    }
    if (!command) throw new Error("OpenCode executable unavailable")
  }
  const environment = createSmokeEnvironment(temporary)
  await execute(command, ["plugin", packageDirectory, "--global", "--pure"], { cwd: temporary, env: environment, windowsHide: true, timeout: 60_000 })
  for (const filename of ["opencode.json", "tui.json"]) {
    const config = JSON.parse(await readFile(path.join(configDirectory, filename), "utf8"))
    assert.ok(config.plugin?.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === packageDirectory), `${filename} must register the local package`)
  }
  console.log("Installer smoke passed (one package discovered as server + TUI; isolated config/home)")
} finally {
  await rm(temporary, { recursive: true, force: true })
}