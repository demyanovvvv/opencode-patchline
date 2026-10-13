import { afterEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { installPatchline, uninstallPatchline } from "../src/installer.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-installer-lifecycle-")))
  roots.push(root)
  return root
}

describe("installer lifecycle", () => {
  it("forces replacement when installing over a pinned version", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "opencode.json"), '{"plugin":["opencode-patchline@1.0.0","other"]}')
    const commands: string[][] = []
    expect(await installPatchline({
      cwd: root, stdout: () => undefined, hasCommand: async () => true,
      runCommand: async (command, args) => { commands.push([command, ...args]); return 0 },
    })).toBe(0)
    expect(commands[0]).toEqual(["opencode", "plugin", "opencode-patchline", "--force"])
    expect(parse(await readFile(path.join(root, "opencode.json"), "utf8")).plugin).toEqual(["opencode-patchline", "other"])
  })

  it("removes the selected scope's direct Patchline package dependency", async () => {
    const root = await workspace()
    await mkdir(path.join(root, ".opencode"))
    const directory = path.join(root, ".opencode")
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ dependencies: { "opencode-patchline": "1.0.0", other: "1.0.0" } }))
    const commands: string[][] = []
    expect(await uninstallPatchline({
      cwd: root, yes: true, stdout: () => undefined,
      runCommand: async (command, args) => { commands.push([command, ...args]); return 0 },
    })).toBe(0)
    expect(commands).toEqual([["npm", "uninstall", "--prefix", directory, "--ignore-scripts", "opencode-patchline"]])
  })

  it("rejects package changes during confirmation before invoking npm", async () => {
    const root = await workspace()
    const file = path.join(root, "package.json")
    await writeFile(file, '{"dependencies":{"opencode-patchline":"1.0.0"}}')
    let invoked = false
    expect(await uninstallPatchline({
      cwd: root, stdout: () => undefined, stderr: () => undefined,
      confirm: async () => { await writeFile(file, '{"dependencies":{"other":"1.0.0"}}'); return true },
      runCommand: async () => { invoked = true; return 0 },
    })).toBe(1)
    expect(invoked).toBe(false)
  })

  it("retains installer state when scoped package removal fails", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "package.json"), '{"dependencies":{"opencode-patchline":"1.0.0"}}')
    const state = path.join(root, ".opencode-patchline-state.json")
    await writeFile(state, '{"scope":"project","language":"ru"}')
    expect(await uninstallPatchline({
      cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined,
      runCommand: async () => 7,
    })).toBe(7)
    expect(JSON.parse(await readFile(state, "utf8"))).toMatchObject({ scope: "project" })
  })

  it("previews scoped package cleanup without invoking npm", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "package.json"), '{"devDependencies":{"opencode-patchline":"1.0.0"}}')
    const lines: string[] = []
    expect(await uninstallPatchline({
      cwd: root, dryRun: true, stdout: (line) => lines.push(line),
      runCommand: async () => { throw new Error("dry-run invoked npm") },
    })).toBe(0)
    expect(lines.join("\n")).toContain(path.join(root, "package.json"))
  })
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

  it("rolls back registration and state when dependency installation fails", async () => {
    const root = await workspace()
    expect(await installPatchline({
      cwd: root, language: "ru", yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false, runCommand: async (command, args) => command === "npm" && args[0] === "install" ? 1 : 0,
    })).toBe(1)
    await expect(readFile(path.join(root, ".opencode-patchline-state.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("restores the local package manifest when dependency installation fails", async () => {
    const root = await workspace()
    const manifest = path.join(root, "package.json")
    const source = '{"name":"fixture","dependencies":{"other":"1.0.0"}}\n'
    await writeFile(manifest, source)
    expect(await installPatchline({
      cwd: root, language: "en", yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false,
      runCommand: async (command, args) => {
        if (command === "npm") await writeFile(manifest, '{"name":"fixture","dependencies":{"other":"1.0.0","typescript":"latest"}}\n')
        return command === "npm" && args[0] === "install" ? 1 : 0
      },
    })).toBe(1)
    expect(await readFile(manifest, "utf8")).toBe(source)
  })

  it("removes a newly created plugin config when a later install phase fails", async () => {
    const root = await workspace()
    const config = path.join(root, "opencode.json")
    expect(await installPatchline({
      cwd: root, language: "en", yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async (command) => command === "opencode" || command === "bun",
      runCommand: async (command, args) => {
        if (command === "opencode") {
          await writeFile(config, '{"plugin":["opencode-patchline"]}')
          return 0
        }
        return args[0] === "install" ? 9 : 0
      },
    })).toBe(9)
    await expect(readFile(config, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
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

  it("does not write a legacy global TypeScript override", async () => {
    const root = await workspace()
    const file = path.join(root, "opencode.json")
    await writeFile(file, '{"plugin":["other"]}\n')
    await installPatchline({
      cwd: root, global: true, yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false,
      runCommand: async (command) => {
        if (command === "opencode") {
          const config = parse(await readFile(file, "utf8"))
          config.plugin.push("opencode-patchline")
          await writeFile(file, JSON.stringify(config, null, 2))
        }
        return 0
      },
    })
    expect(parse(await readFile(file, "utf8")).lsp).toBeUndefined()
  })
})
