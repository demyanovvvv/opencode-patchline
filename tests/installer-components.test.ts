import { afterEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installPatchline, uninstallPatchline } from "../src/installer.js"
import { runCli } from "../src/cli.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-components-")))
  roots.push(root)
  return root
}

describe("installer component selection", () => {
  it("previews installation without commands, confirmation, state or backups", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "opencode.jsonc"), '{/* keep */"plugin":["other"]}\n')
    const before = await readdir(root)
    const lines: string[] = []
    expect(await runCli(["install", "--dry-run", "--cwd", root, "--no-host", "--no-lsp", "--lang=ru"], {
      stdout: (line) => lines.push(line), stderr: () => undefined,
      installer: { runCommand: async () => { throw new Error("Unexpected command") }, confirm: async () => { throw new Error("Unexpected prompt") } },
    })).toBe(0)
    expect(await readdir(root)).toEqual(before)
    expect(await readFile(path.join(root, "opencode.jsonc"), "utf8")).toContain("/* keep */")
    expect(lines.join("\n")).toContain(root)
    expect(lines.join("\n")).toContain("opencode-patchline")
    expect(lines.join("\n")).toContain("Хост")
  })

  it("skips LSP independently of Bun provisioning", async () => {
    const root = await workspace()
    const calls: string[][] = []
    expect(await installPatchline({ cwd: root, noHost: true, noLsp: true, yes: true, stdout: () => undefined,
      hasCommand: async () => false, runCommand: async (_command, args) => { calls.push([...args]); return 0 },
    })).toBe(0)
    expect(calls).toEqual([["plugin", "opencode-patchline"], ["install", "--global", "bun"]])
    const state = JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8"))
    expect(state.lspPackages).toEqual([])
    expect(state.addonPackages).toEqual(["bun"])
  })

  it("keeps dependencies while removing registrations and owned LSP configuration", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "package.json"), '{"devDependencies":{"opencode-patchline":"1.3.0","typescript":"5"}}')
    await writeFile(path.join(root, "opencode.json"), '{"plugin":["other","opencode-patchline"]}')
    await writeFile(path.join(root, ".opencode-patchline-state.json"), JSON.stringify({ schemaVersion: 1, scope: "project", lspPackages: ["typescript"], addonPackages: ["bun"] }))
    const calls: string[] = []
    expect(await uninstallPatchline({ cwd: root, keepDeps: true, yes: true, stdout: () => undefined,
      runCommand: async (command) => { calls.push(command); return 0 },
    })).toBe(0)
    expect(calls).toEqual([])
    expect(JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8")).plugin).toEqual(["other"])
    expect(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).devDependencies.typescript).toBe("5")
  })

  it("rejects an unbuilt explicit package before changing the project", async () => {
    const root = await workspace()
    const source = path.join(root, "source")
    await mkdir(source)
    await writeFile(path.join(source, "package.json"), '{"name":"opencode-patchline"}')
    const errors: string[] = []
    const calls: string[] = []
    expect(await runCli(["install", "--package", source, "--cwd", root], {
      stdout: () => undefined, stderr: (line) => errors.push(line),
      installer: { runCommand: async (command) => { calls.push(command); return 0 } },
    })).toBe(1)
    expect(calls).toEqual([])
    expect(errors.join("\n")).toContain("built")
  })
  it("preserves ownership state changed during confirmation before removing anything", async () => {
    const root = await workspace()
    const file = path.join(root, "opencode.json")
    const state = path.join(root, ".opencode-patchline-state.json")
    await writeFile(file, '{"plugin":["opencode-patchline"]}')
    await writeFile(state, '{"schemaVersion":1,"scope":"project"}')
    expect(await uninstallPatchline({ cwd: root, stdout() {}, stderr() {}, confirm: async () => {
      await writeFile(state, '{"schemaVersion":1,"scope":"project","language":"ru"}')
      return true
    } })).toBe(1)
    expect(await readFile(state, "utf8")).toContain('"language":"ru"')
    expect(await readFile(file, "utf8")).toContain("opencode-patchline")
  })
})
