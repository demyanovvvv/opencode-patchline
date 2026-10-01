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
  protectVisualHostUpdates,
  resolveInstalledOpenCode,
  integratedHostVersion,
  patchHostUpdates,
} from "../src/installer.js"

describe("Patchline installer", () => {
  it("derives integrated versions independently from upstream and plugin versions", () => {
    expect(integratedHostVersion("1.18.34", "1.1.0")).toBe("1.18.34+patchline.1.1.0")
    expect(integratedHostVersion("1.18.35", "1.1.0")).toBe("1.18.35+patchline.1.1.0")
    expect(integratedHostVersion("1.18.35", "1.1.1-beta.1")).toBe("1.18.35+patchline.1.1.1-beta.1")
    expect(() => integratedHostVersion("latest", "1.1.0")).toThrow()
    expect(() => integratedHostVersion("1.18.34", "broken")).toThrow()
  })

  it("routes integrated host upgrades through the installer instead of stock npm replacement", () => {
    const original = 'upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {\n        let upgradeResult: { code: number; stdout: string; stderr: string } | undefined\n        switch (m) {'
    const updated = patchHostUpdates(original, "D:/plugin/dist/cli.js")
    expect(updated).toContain('"--opencode-version", target')
    expect(updated).toContain('"D:/plugin/dist/cli.js"')
    expect(updated).toContain('switch (m)')
    expect(patchHostUpdates(updated, "D:/plugin/dist/cli.js")).toBe(updated)
    expect(() => patchHostUpdates("unsupported", "cli.js")).toThrow()
  })
  it("protects the custom UI host from automatic stock replacement without overwriting explicit preferences", async () => {
    const root = await workspace("patchline-host-update-")
    const file = path.join(root, "opencode.jsonc")
    await writeFile(file, '{\n  // retain user configuration\n  "plugin": ["other"]\n}\n')
    await protectVisualHostUpdates(file)
    const updated = await readFile(file, "utf8")
    expect(updated).toContain('// retain user configuration')
    expect(updated).toContain('"autoupdate": "notify"')
    expect(updated).toContain('"other"')
    for (const value of [true, false, "notify"]) {
      await writeFile(file, JSON.stringify({ autoupdate: value, plugin: ["other"] }))
      await protectVisualHostUpdates(file)
      expect(JSON.parse(await readFile(file, "utf8")).autoupdate).toBe(value === true ? "notify" : value)
    }
  })

  it("resolves a canonical installed host path", async () => {
    const root = await workspace("patchline-host-path-")
    await writeFile(path.join(root, "opencode.exe"), "host")
    expect(await resolveInstalledOpenCode(root)).toBe(path.join(root, "opencode.exe"))
  })
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
      hasCommand: async (command) => command === "bun" || command === "opencode",
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

  it("offers Bun separately when native Hashline runtime is missing", async () => {
    const root = await workspace("patchline-installer-runtime-test-")
    const output: string[] = []
    const commands: Array<{ command: string; args: string[] }> = []

    const exitCode = await installPatchline({
      cwd: root,
      stateDirectory: root,
      configDirectory: root,
      global: true,
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
      confirm: async () => true,
      hasCommand: async (command) => command !== "bun",
      runCommand: async (command, args) => {
        commands.push({ command, args: [...args] })
        return 0
      },
    })

    expect(exitCode).toBe(0)
    expect(commands).toEqual([
      { command: "opencode", args: ["plugin", "opencode-patchline", "--global"] },
      { command: "npm", args: ["install", "--global", "bun"] },
    ])
    expect(output.join("\n")).toContain("Bun")
    expect(JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8")).addonPackages).toEqual(["bun"])
  })

  it("does not install Bun when its separate confirmation is declined", async () => {
    const root = await workspace("patchline-installer-runtime-test-")
    const commands: string[][] = []

    expect(await installPatchline({
      cwd: root,
      stateDirectory: root,
      configDirectory: root,
      global: true,
      confirm: async () => false,
      hasCommand: async (command) => command !== "bun",
      stdout: () => undefined,
      runCommand: async (command, args) => { commands.push([command, ...args]); return 0 },
    })).toBe(0)
    expect(commands).toEqual([["opencode", "plugin", "opencode-patchline", "--global"]])
  })

  it("removes installer-owned Bun together with the plugin", async () => {
    const root = await workspace("patchline-uninstaller-runtime-test-")
    const config = path.join(root, "opencode.json")
    await writeFile(config, JSON.stringify({ plugin: ["opencode-patchline"] }) + "\n")
    await writeFile(path.join(root, ".opencode-patchline-state.json"), JSON.stringify({ scope: "project", addonPackages: ["bun"] }))
    const commands: string[][] = []

    expect(await uninstallPatchline({
      cwd: root,
      configDirectory: root,
      stateDirectory: root,
      yes: true,
      stdout: () => undefined,
      runCommand: async (_command, args) => { commands.push([...args]); return 0 },
      hasCommand: async () => true,
    })).toBe(0)
    expect(commands).toEqual([["uninstall", "--global", "bun"]])
    await expect(readFile(path.join(root, ".opencode-patchline-state.json"), "utf8")).rejects.toThrow()
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
  it("deduplicates registrations after install and retains the existing options", async () => {
    const root = await workspace("patchline-dedup-")
    const config = path.join(root, "opencode.json")
    const target = path.join(root, "opencode-patchline")
    await writeFile(config, JSON.stringify({ plugin: ["other", [target, { mode: "precision", summary: true }], `${target}/`] }))
    const code = await installPatchline({ cwd: root, packageName: target, stdout: () => undefined, stderr: () => undefined, hasCommand: async () => true,
      runCommand: async () => { const data = JSON.parse(await readFile(config, "utf8")); data.plugin.push(target); await writeFile(config, JSON.stringify(data)); return 0 },
    })
    expect(code).toBe(0)
    expect(JSON.parse(await readFile(config, "utf8")).plugin).toEqual(["other", [target, { mode: "precision", summary: true }]])
  })
})