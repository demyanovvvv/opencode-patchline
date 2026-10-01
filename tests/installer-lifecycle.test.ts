import { afterEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { installPatchline, uninstallPatchline } from "../src/installer.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-installer-lifecycle-"))
  roots.push(root)
  return root
}

describe("installer lifecycle", () => {
  it("restores previous configurations when OpenCode registration partially fails", async () => {
    const root = await workspace()
    await mkdir(path.join(root, ".opencode"))
    const file = path.join(root, ".opencode", "opencode.json")
    const source = '{"plugin":["other"]}'
    await writeFile(file, source)
    expect(await installPatchline({
      cwd: root, stdout: () => undefined, stderr: () => undefined,
      runCommand: async () => { await writeFile(file, '{"plugin":["other","opencode-patchline"]}'); return 1 },
    })).toBe(1)
    expect(await readFile(file, "utf8")).toBe(source)
  })

  it("saves registration and language even when dependency installation fails", async () => {
    const root = await workspace()
    expect(await installPatchline({
      cwd: root, language: "ru", yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false, runCommand: async (command) => command === "npm" ? 1 : 0,
    })).toBe(1)
    expect(JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8"))).toMatchObject({ language: "ru", lspPackages: [] })
  })

  it("configures an installed TypeScript LSP and removes only its owned settings", async () => {
    const root = await workspace()
    await mkdir(path.join(root, ".opencode"))
    const file = path.join(root, ".opencode", "opencode.json")
    await writeFile(file, '{\n // user settings\n "plugin": ["other"],\n "lsp": {"custom":{"command":["custom-lsp"],"extensions":[".custom"]}}\n}\n')
    expect(await installPatchline({
      cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined, hasCommand: async () => false,
      runCommand: async (command) => {
        if (command === "opencode") {
          const config = parse(await readFile(file, "utf8"))
          config.plugin.push("opencode-patchline")
          await writeFile(file, JSON.stringify(config, null, 2))
        }
        return 0
      },
    })).toBe(0)
    const installed = parse(await readFile(file, "utf8"))
    expect(installed.lsp.typescript).toMatchObject({ extensions: expect.arrayContaining([".ts", ".tsx"]), command: expect.arrayContaining(["--stdio"]) })
    expect(await uninstallPatchline({ cwd: root, yes: true, stdout: () => undefined, runCommand: async () => 0 })).toBe(0)
    const removed = parse(await readFile(file, "utf8"))
    expect(removed.lsp).toEqual({ custom: { command: ["custom-lsp"], extensions: [".custom"] } })
    expect(removed.plugin).toEqual(["other"])
  })

  it("keeps user-disabled LSP and user-replaced language-server configuration", async () => {
    const root = await workspace()
    await mkdir(path.join(root, ".opencode"))
    const file = path.join(root, ".opencode", "opencode.json")
    await writeFile(file, '{"plugin":["opencode-patchline"],"lsp":false}')
    await installPatchline({ cwd: root, yes: true, stdout: () => undefined, hasCommand: async () => false, runCommand: async () => 0 })
    expect(parse(await readFile(file, "utf8")).lsp).toBe(false)
  })
})