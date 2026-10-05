import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createSmokeEnvironment } from "./smoke-environment.mjs"
import { parse } from "jsonc-parser"
import { createServer } from "node:net"

const execute = promisify(execFile)
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url))
const installer = new URL("../dist/installer.js", import.meta.url).href
const temporary = await mkdtemp(path.join(os.tmpdir(), "patchline-installer-lifecycle-smoke-"))
try {
  const configDirectory = path.join(temporary, "config", "opencode")
  await mkdir(configDirectory, { recursive: true })
  await writeFile(path.join(configDirectory, "opencode.json"), "{}\n")
  await writeFile(path.join(configDirectory, "tui.json"), "{}\n")
  const environment = createSmokeEnvironment(temporary)
  const verifyHost = process.argv.includes("--host")
  if (verifyHost) {
    const bin = path.join(temporary, "bin")
    await mkdir(bin)
    let original
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
      for (const candidate of [path.join(directory, "opencode.exe"), path.join(directory, "node_modules", "opencode-ai", "bin", "opencode.exe")]) {
        try { await access(candidate); original = candidate; break } catch { /* Next candidate. */ }
      }
      if (original) break
    }
    assert.ok(original, "Installed OpenCode required")
    await copyFile(original, path.join(bin, "opencode.exe"))
    const inheritedPath = Object.entries(environment).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? ""
    for (const key of Object.keys(environment)) if (key.toUpperCase() === "PATH") delete environment[key]
    environment.PATH = bin + path.delimiter + inheritedPath
    if (process.env.OPENCODE_PATCHLINE_HOST_SOURCE) environment.OPENCODE_PATCHLINE_HOST_SOURCE = process.env.OPENCODE_PATCHLINE_HOST_SOURCE
  }
  const run = (args) => execute(process.execPath, [cli, ...args], { cwd: temporary, env: environment, windowsHide: true, timeout: verifyHost ? 900_000 : 120_000, maxBuffer: 20_000_000 })
  let installed
  try {
    installed = verifyHost
      ? await run(["install", "--local", "--global", "--yes", "--lang", "ru", "--opencode-version", "1.18.34"])
      : await execute(process.execPath, ["--input-type=module", "-e", `import { installPatchline } from ${JSON.stringify(installer)}; import { executeCommand } from ${JSON.stringify(new URL("../dist/installation/process.js", import.meta.url).href)}; process.exitCode = await installPatchline({ global: true, packageName: ${JSON.stringify(fileURLToPath(new URL("..", import.meta.url)))}, language: "ru", runCommand: async (command, args) => (await executeCommand(command, args, process.cwd(), true)).code });`], { cwd: temporary, env: environment, windowsHide: true, timeout: 120_000, maxBuffer: 5_000_000 })
  } catch (error) {
    console.error(error.stdout ?? "", error.stderr ?? "")
    throw error
  }
  assert.match(installed.stdout, /Установка/)
  if (verifyHost) {
    assert.match(installed.stdout, /OpenCode UI host installed/)
    const host = path.join(temporary, "bin", "opencode.exe")
    const version = await execute(host, ["--version"], { cwd: temporary, env: environment })
    const { integratedHostVersion } = await import("../dist/installer.js")
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
    assert.equal(version.stdout.trim(), integratedHostVersion("1.18.34", manifest.version))
    const reservation = createServer()
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    const server = spawn(host, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: temporary, env: environment, windowsHide: true, stdio: "ignore" })
    let startupError
    server.on("error", (error) => { startupError = error })
    try {
      let ready = false
      for (let attempt = 0; attempt < 120; attempt++) {
        if (startupError) throw startupError
        try { ready = (await fetch(`http://127.0.0.1:${port}/global/health`)).ok } catch { /* Starting. */ }
        if (ready) break
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      assert.ok(ready, "Isolated host must start")
      for (const model of ["gpt-5", "claude-sonnet-4", "gemini-2.5-pro"]) {
        const response = await fetch(`http://127.0.0.1:${port}/experimental/tool?provider=anthropic&model=${model}`)
        if (!response.ok) assert.fail(await response.text())
        const tools = await response.json()
        for (const id of ["apply_patch", "edit", "write"]) assert.ok(tools.some((tool) => tool.id === id), `${model}: missing ${id}`)
      }
    } finally {
      if (server.exitCode === null) {
        const closed = new Promise((resolve) => server.once("close", resolve))
        server.kill()
        await closed
      }
    }
  }
  for (const filename of ["opencode.json", "tui.json"]) {
    const file = path.join(configDirectory, filename)
    const config = parse(await readFile(file, "utf8"))
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