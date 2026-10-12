import assert from "node:assert/strict"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { resolveInstalledOpenCode } from "../dist/installer.js"
import { executeCommand } from "../dist/installation/process.js"
import { createSmokeEnvironment } from "./smoke-environment.mjs"

const root = await mkdtemp(path.join(os.tmpdir(), "pl-hu-"))
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url))
const packageRoot = path.dirname(path.dirname(cli))
const version = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version
const targetVersion = process.argv[2] ?? "1.19.0"
try {
  const binary = path.join(root, process.platform === "win32" ? "opencode.exe" : "opencode")
  await copyFile(await resolveInstalledOpenCode(), binary)
  if (process.platform !== "win32") await import("node:fs/promises").then(({ chmod }) => chmod(binary, 0o755))
  const config = path.join(root, "config", "opencode")
  await mkdir(config, { recursive: true })
  const configuration = '{"autoupdate":false,"plugin":["unrelated"],"lsp":{"custom":false}}\n'
  const tui = '{"plugin":["unrelated-tui"]}\n'
  await writeFile(path.join(config, "opencode.json"), configuration)
  await writeFile(path.join(config, "tui.json"), tui)
  const environment = createSmokeEnvironment(root)
  const initial = (await executeCommand(binary, ["--version"], root)).output
  const args = [cli, "host-upgrade", "--opencode-version", targetVersion, "--host-binary", binary, "--expected-host-version", initial, "--rebuild"]
  const result = await executeCommand(process.execPath, args, root, true, environment)
  assert.equal(result.code, 0, "Host rebuild failed")
  assert.equal((await executeCommand(binary, ["--version"], root)).output, `${targetVersion}+patchline.${version}`)
  assert.equal(await readFile(path.join(config, "opencode.json"), "utf8"), configuration)
  assert.equal(await readFile(path.join(config, "tui.json"), "utf8"), tui)
  // Both UI and CLI delegate to Installation.upgrade. Exercise the real command path.
  const from = targetVersion === "1.19.0" ? "1.18.35" : "1.19.0"
  const downgrade = await executeCommand(binary, ["upgrade", from, "--method", "npm"], root, true, environment)
  assert.equal(downgrade.code, 0)
  assert.equal((await executeCommand(binary, ["--version"], root)).output, `${from}+patchline.${version}`)
  const upgrade = await executeCommand(binary, ["upgrade", targetVersion, "--method", "npm"], root, true, environment)
  assert.equal(upgrade.code, 0)
  assert.equal((await executeCommand(binary, ["--version"], root)).output, `${targetVersion}+patchline.${version}`)
  const repeated = await executeCommand(binary, ["upgrade", targetVersion, "--method", "npm"], root, false, environment)
  assert.match(repeated.output, /already installed/)
  assert.equal(await readFile(path.join(config, "opencode.json"), "utf8"), configuration)
  assert.equal(await readFile(path.join(config, "tui.json"), "utf8"), tui)
  console.log("Host upgrade smoke passed: rebuild, CLI downgrade/upgrade, idempotence and byte-identical plugin configuration")
} finally { await rm(root, { recursive: true, force: true }) }
