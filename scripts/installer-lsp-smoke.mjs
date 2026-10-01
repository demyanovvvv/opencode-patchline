import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installPatchline, uninstallPatchline } from "../dist/installer.js"
import { executeCommand } from "../dist/installation/process.js"

const root = await mkdtemp(path.join(os.tmpdir(), "patchline-installer-lsp-smoke-"))
try {
  await mkdir(path.join(root, ".opencode"))
  await writeFile(path.join(root, "package.json"), '{"name":"patchline-lsp-smoke","private":true}\n')
  const installed = await installPatchline({
    cwd: root, yes: true, language: "ru", hasCommand: async (command) => command === "bun",
    runCommand: async (command, args) => {
      if (command === "opencode") {
        await writeFile(path.join(root, ".opencode", "opencode.json"), '{"plugin":["opencode-patchline"]}\n')
        return 0
      }
      return (await executeCommand(command, args, root)).code
    },
  })
  assert.equal(installed, 0)
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assert.ok(manifest.devDependencies.typescript)
  assert.ok(manifest.devDependencies["typescript-language-server"])
  const config = JSON.parse(await readFile(path.join(root, ".opencode", "opencode.json"), "utf8"))
  assert.deepEqual(config.lsp.typescript.command.slice(-1), ["--stdio"])
  const probe = await executeCommand(config.lsp.typescript.command[0], [...config.lsp.typescript.command.slice(1, -1), "--version"], root)
  assert.equal(probe.code, 0)
  const removed = await uninstallPatchline({ cwd: root, yes: true })
  assert.equal(removed, 0)
  const after = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assert.equal(after.devDependencies?.typescript, undefined)
  assert.equal(after.devDependencies?.["typescript-language-server"], undefined)
  console.log("Installer LSP smoke passed: actual npm installation, configured server launch and dependency removal")
} finally {
  await rm(root, { recursive: true, force: true })
}