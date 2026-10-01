import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const roots: string[] = []
async function workspace(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
import {
  installPatchline,
  removePatchlineEntries,
  uninstallPatchline,
} from "../src/installer.js"

describe("Patchline installer", () => {
  it("installs missing LSP dependencies only after confirmation and localizes installer output", async () => {
    const root = await workspace("patchline-installer-test-")
    const output: string[] = []
    const commands: Array<{ command: string; args: string[] }> = []

    const exitCode = await installPatchline({
      cwd: root,
      stateDirectory: root,
      language: "ru",
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
      confirm: async () => true,
      hasCommand: async () => false,
      runCommand: async (command, args) => {
        commands.push({ command, args: [...args] })
        return 0
      },
    })

    expect(exitCode).toBe(0)
    expect(commands).toEqual([
      { command: "opencode", args: ["plugin", "opencode-patchline"] },
      { command: "npm", args: ["install", "--save-dev", "typescript", "typescript-language-server"] },
    ])
    expect(output.join("\n")).toContain("Установка opencode-patchline")
    expect(output.join("\n")).toContain("Зависимости LSP установлены")
  })

  it("does not install LSP dependencies when confirmation is declined", async () => {
    const root = await workspace("patchline-installer-test-")
    const commands: string[] = []

    const exitCode = await installPatchline({
      cwd: root,
      stateDirectory: root,
      stdout: () => undefined,
      stderr: () => undefined,
      confirm: async () => false,
      hasCommand: async () => false,
      runCommand: async (command) => {
        commands.push(command)
        return 0
      },
    })

    expect(exitCode).toBe(0)
    expect(commands).toEqual(["opencode"])
  })

  it("removes only Patchline entries while preserving other plugins", () => {
    const source = `{
  "plugin": [
    "other-plugin",
    "opencode-patchline",
    ["another-plugin", { "enabled": true }]
  ],
  "theme": "default"
}`

    const result = removePatchlineEntries(source)

    expect(result.removed).toBe(1)
    expect(JSON.parse(result.text)).toEqual({
      plugin: ["other-plugin", ["another-plugin", { enabled: true }]],
      theme: "default",
    })
  })

  it("supports a dry-run and removes the registered plugin and owned dependencies", async () => {
    const root = await workspace("patchline-uninstaller-test-")
    const config = path.join(root, "opencode.json")
    await writeFile(config, JSON.stringify({ plugin: ["other-plugin", "opencode-patchline"] }, null, 2) + "\n")
    await writeFile(path.join(root, ".opencode-patchline-state.json"), JSON.stringify({
      lspPackages: ["typescript-language-server"],
      scope: "project",
    }))

    const dryRunOutput: string[] = []
    const dryRunCode = await uninstallPatchline({
      cwd: root,
      configDirectory: root,
      stateDirectory: root,
      dryRun: true,
      stdout: (line) => dryRunOutput.push(line),
      stderr: (line) => dryRunOutput.push(line),
      runCommand: async () => {
        throw new Error("dry-run must not execute commands")
      },
    })

    expect(dryRunCode).toBe(0)
    expect(dryRunOutput.join("\n")).toContain("Would remove")
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({ plugin: ["other-plugin", "opencode-patchline"] })

    const commands: Array<{ command: string; args: string[] }> = []
    const exitCode = await uninstallPatchline({
      cwd: root,
      configDirectory: root,
      stateDirectory: root,
      yes: true,
      stdout: () => undefined,
      stderr: () => undefined,
      runCommand: async (command, args) => {
        commands.push({ command, args: [...args] })
        return 0
      },
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({ plugin: ["other-plugin"] })
    expect(commands).toEqual([{ command: "npm", args: ["uninstall", "--save-dev", "typescript-language-server"] }])
  })
})