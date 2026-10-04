import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { installPatchline, removePatchlineEntries, uninstallPatchline } from "../src/installer.js"
import { removeOwnedLsp } from "../src/installation/lsp.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-installer-regression-")))
  roots.push(root)
  return root
}

describe("installer regressions", () => {
  it("retains ownership state when dependency cleanup fails", async () => {
    const root = await workspace()
    const errors: string[] = []
    expect(await installPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: (line) => errors.push(line),
      hasCommand: async (command) => { if (command === "bun") throw new Error("later failure"); return false },
      runCommand: async (command, args) => command === "npm" && args[0] === "uninstall" ? 7 : 0,
    })).toBe(1)
    expect(JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8")).lspPackages).toContain("typescript")
    expect(errors.join("\n")).toContain("7")
  })
  it("restores a pre-existing pinned plugin after a later failure", async () => {
    const root = await workspace()
    const file = path.join(root, "opencode.json")
    const source = '{"plugin":[["opencode-patchline@1.0.0",{"enabled":true}],"other"]}\n'
    await writeFile(file, source)
    expect(await installPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false, runCommand: async (command, args) => command === "npm" && args[0] === "install" ? 9 : 0,
    })).toBe(9)
    expect(await readFile(file, "utf8")).toBe(source)
  })
  it("restores the previous installer state byte for byte", async () => {
    const root = await workspace()
    const file = path.join(root, ".opencode-patchline-state.json")
    const source = '{ "language": "ru", "scope": "project" }\r\n'
    await writeFile(file, source)
    expect(await installPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false, runCommand: async (command, args) => command === "npm" && args[0] === "install" ? 9 : 0,
    })).toBe(9)
    expect(await readFile(file, "utf8")).toBe(source)
  })
  it("rolls back dependencies when npm throws after a partial install", async () => {
    const root = await workspace()
    const calls: string[] = []
    expect(await installPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false,
      runCommand: async (command, args) => {
        calls.push(`${command}:${args[0]}`)
        if (command === "npm" && args[0] === "install") throw new Error("partial install")
        return 0
      },
    })).toBe(1)
    expect(calls).toContain("npm:uninstall")
  })
  it.each(["package.json", ".opencode-patchline-state.json"])("preserves an external %s edit before rollback", async (name) => {
    const root = await workspace()
    const file = path.join(root, name)
    const external = '{"user":"external"}\n'
    if (name === "package.json") await writeFile(file, '{"name":"fixture"}\n')
    const errors: string[] = []
    expect(await installPatchline({
      cwd: root, yes: true, stdout: () => undefined, stderr: (line) => errors.push(line),
      hasCommand: async (command) => {
        if (command === "bun") { await writeFile(file, external); throw new Error("later failure") }
        return false
      },
      runCommand: async (command, args) => {
        if (command === "npm" && args[0] === "install") await writeFile(path.join(root, "package.json"), '{"name":"fixture","devDependencies":{"typescript":"latest"}}\n')
        return 0
      },
    })).toBe(1)
    expect(await readFile(file, "utf8")).toBe(external)
    expect(errors.join("\n")).toContain("conflict")
  })
  it("preserves unrelated settings in a newly created config during rollback", async () => {
    const root = await workspace()
    const file = path.join(root, "opencode.json")
    expect(await installPatchline({
      cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => false,
      runCommand: async (command, args) => {
        if (command === "opencode") await writeFile(file, '{"plugin":["opencode-patchline"],"theme":"custom"}')
        return command === "npm" && args[0] === "install" ? 9 : 0
      },
    })).toBe(9)
    expect(parse(await readFile(file, "utf8"))).toEqual({ plugin: [], theme: "custom" })
  })
  it.each([
    ["opencode-patchline"],
    ["opencode-patchline", "opencode-patchline@1.1.0"],
    ["other", "opencode-patchline", "opencode-patchline/tui"],
    ["opencode-patchline", "other", "opencode-patchline"],
  ])("removes duplicate registrations without changing other entries: %j", (...entries) => {
    const result = removePatchlineEntries(JSON.stringify({ plugin: entries }))
    expect(JSON.parse(result.text).plugin).toEqual(entries.filter((entry) => entry === "other"))
  })

  it("preserves comments inside surviving plugin tuples and around removed entries", () => {
    const source = '{"plugin": [["other", {/* user option */ "enabled":true}], /* keep comment */ "opencode-patchline"]}'
    const result = removePatchlineEntries(source)
    expect(result.text).toContain("/* user option */")
    expect(result.text).toContain("/* keep comment */")
    expect(parse(result.text).plugin).toEqual([["other", { enabled: true }]])
  })

  it("retains language-server settings edited by the user after installation", () => {
    const owned = { file: "opencode.json", value: { command: ["original", "--stdio"], extensions: [".ts"] } }
    const source = JSON.stringify({ lsp: { typescript: { command: ["custom", "--stdio"], extensions: [".ts"] } } })
    expect(removeOwnedLsp(source, owned)).toBe(source)
  })

  it("repairs missing installations of existing dependencies without claiming them", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "package.json"), '{"devDependencies":{"typescript":"5.9.2","typescript-language-server":"6.0.1"}}')
    const calls: string[][] = []
    expect(await installPatchline({ cwd: root, yes: true, stdout: () => undefined, hasCommand: async () => false, runCommand: async (_command, args) => { calls.push([...args]); return 0 } })).toBe(0)
    expect(calls).toContainEqual(["install"])
    expect(JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8")).lspPackages).toEqual([])
  })

  it("preserves previously owned LSP settings when a reinstall fails", async () => {
    const root = await workspace()
    const stateFile = path.join(root, ".opencode-patchline-state.json")
    const lspConfig = { file: path.join(root, "opencode.json"), value: { command: ["server", "--stdio"], extensions: [".ts"] } }
    await writeFile(stateFile, JSON.stringify({ scope: "project", language: "ru", lspPackages: ["typescript-language-server"], lspConfig }))
    expect(await installPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined, hasCommand: async () => false, runCommand: async (command) => command === "npm" ? 1 : 0 })).toBe(1)
    expect(JSON.parse(await readFile(stateFile, "utf8")).lspConfig).toEqual(lspConfig)
  })

  it("retains removal state after npm fails so cleanup can be retried", async () => {
    const root = await workspace()
    const state = path.join(root, ".opencode-patchline-state.json")
    await writeFile(state, '{"scope":"project","lspPackages":["typescript-language-server"]}')
    expect(await uninstallPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined, runCommand: async () => 1 })).toBe(1)
    expect(JSON.parse(await readFile(state, "utf8")).lspPackages).toEqual(["typescript-language-server"])
  })
})