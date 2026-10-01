import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createSmokeEnvironment } from "./smoke-environment.mjs"

const execute = promisify(execFile)
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url))
const temporary = await mkdtemp(path.join(os.tmpdir(), "patchline-installer-lifecycle-smoke-"))
try {
  const configDirectory = path.join(temporary, "config", "opencode")
  await mkdir(configDirectory, { recursive: true })
  const environment = createSmokeEnvironment(temporary)
  const run = (args) => execute(process.execPath, [cli, ...args], { cwd: temporary, env: environment, windowsHide: true, timeout: 120_000, maxBuffer: 5_000_000 })
  const installed = await run(["install", "--local", "--global", "--lang", "ru"])
  assert.match(installed.stdout, /Установка/)
  for (const filename of ["opencode.json", "tui.json"]) {
    const file = path.join(configDirectory, filename)
    const config = JSON.parse(await readFile(file, "utf8"))
    assert.equal(config.plugin?.length, 1, `${filename} should register the local package once`)
    config.plugin.push("unrelated-smoke-plugin")
    await writeFile(file, JSON.stringify(config, null, 2) + "\n")
  }
  const before = await readFile(path.join(configDirectory, "opencode.json"), "utf8")
  const preview = await run(["uninstall", "--global", "--dry-run"])
  assert.match(preview.stdout, /Будет удалено/)
  assert.equal(await readFile(path.join(configDirectory, "opencode.json"), "utf8"), before)
  await run(["uninstall", "--global", "--yes"])
  for (const filename of ["opencode.json", "tui.json"]) {
    const config = JSON.parse(await readFile(path.join(configDirectory, filename), "utf8"))
    assert.deepEqual(config.plugin, ["unrelated-smoke-plugin"])
  }
  await assert.rejects(access(path.join(configDirectory, ".opencode-patchline-state.json")))
  console.log("Installer lifecycle smoke passed: Russian install, read-only preview, removal and unrelated-plugin preservation")
} finally {
  await rm(temporary, { recursive: true, force: true })
}