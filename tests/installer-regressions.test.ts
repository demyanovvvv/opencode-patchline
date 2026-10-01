import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { installPatchline, removePatchlineEntries, uninstallPatchline } from "../src/installer.js"
import { removeOwnedLsp } from "../src/installation/lsp.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-installer-regression-"))
  roots.push(root)
  return root
}

describe("installer regressions", () => {
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