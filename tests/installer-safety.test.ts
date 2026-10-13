import { afterEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { installPatchline, removePatchlineEntries, uninstallPatchline } from "../src/installer.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-installer-safety-")))
  roots.push(root)
  return root
}

describe("installer safety", () => {
  it("does not overwrite a host changed while its replacement was building", async () => {
    const { installHostBinary } = await import("../src/installation/files.js")
    const { captureHostRevision } = await import("../src/installation/host-runtime.js")
    const root = await workspace()
    const source = path.join(root, "new")
    const target = path.join(root, "host")
    await writeFile(source, "new")
    await writeFile(target, "before")
    const revision = await captureHostRevision(target)
    await writeFile(target, "external")
    await expect(installHostBinary(source, target, undefined, revision)).rejects.toThrow(/changed/)
    expect(await readFile(target, "utf8")).toBe("external")
  })
  it("restores the host and prior backup through a guarded rollback", async () => {
    const { installHostBinary } = await import("../src/installation/files.js")
    const root = await workspace()
    const source = path.join(root, "new.exe")
    const target = path.join(root, "opencode.exe")
    const previous = `${target}.patchline-previous`
    await writeFile(source, "new")
    await writeFile(target, "old")
    await writeFile(previous, "older")
    let rollback: (() => Promise<void>) | undefined
    await installHostBinary(source, target, (restore) => { rollback = restore })
    expect(rollback).toBeTypeOf("function")
    await rollback!()
    expect(await readFile(target, "utf8")).toBe("old")
    expect(await readFile(previous, "utf8")).toBe("older")
  })
  it("preserves an externally replaced host during rollback", async () => {
    const { installHostBinary } = await import("../src/installation/files.js")
    const root = await workspace()
    const source = path.join(root, "new.exe")
    const target = path.join(root, "opencode.exe")
    await writeFile(source, "new")
    await writeFile(target, "old")
    let rollback: (() => Promise<void>) | undefined
    await installHostBinary(source, target, (restore) => { rollback = restore })
    await writeFile(target, "external")
    await expect(rollback!()).rejects.toThrow("changed")
    expect(await readFile(target, "utf8")).toBe("external")
  })
  it("accepts a caller workspace alias while still rejecting nested config aliases", async () => {
    const root = await workspace()
    const aliases = await workspace()
    const alias = path.join(aliases, "project")
    try { await symlink(root, alias, process.platform === "win32" ? "junction" : "dir") } catch { return }
    expect(await installPatchline({ cwd: alias, configDirectory: root, stateDirectory: root, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async () => true, runCommand: async () => 0,
    })).toBe(0)
    expect(JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8")).scope).toBe("project")
  })
  it("preserves JSONC comments, BOM, line endings and unrelated configuration", () => {
    const source = '\uFEFF{\r\n  // user settings\r\n  "theme": "custom",\r\n  "plugin": ["other", ["opencode-patchline@1.1.0", {}],],\r\n}\r\n'
    const result = removePatchlineEntries(source)
    expect(result.removed).toBe(1)
    expect(result.text).toContain("// user settings")
    expect(result.text.startsWith("\uFEFF")).toBe(true)
    expect(result.text).not.toMatch(/(?<!\r)\n/)
    expect(parse(result.text.slice(1))).toEqual({ theme: "custom", plugin: ["other"] })
    expect(removePatchlineEntries(result.text)).toEqual({ text: result.text, removed: 0 })
  })

  it("does not mutate configurations when removal confirmation is declined", async () => {
    const root = await workspace()
    const source = '{"plugin":["opencode-patchline"]}'
    await writeFile(path.join(root, "opencode.json"), source)
    expect(await uninstallPatchline({ cwd: root, confirm: async () => false, stdout: () => undefined })).toBe(0)
    expect(await readFile(path.join(root, "opencode.json"), "utf8")).toBe(source)
  })

  it("preflights every configuration before removing anything", async () => {
    const root = await workspace()
    const source = '{"plugin":["opencode-patchline"]}'
    await writeFile(path.join(root, "opencode.json"), source)
    await writeFile(path.join(root, "tui.json"), '{"plugin": [')
    expect(await uninstallPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined })).toBe(1)
    expect(await readFile(path.join(root, "opencode.json"), "utf8")).toBe(source)
  })

  it("rejects a configuration changed while confirmation is pending", async () => {
    const root = await workspace()
    const file = path.join(root, "opencode.json")
    await writeFile(file, '{"plugin":["opencode-patchline"]}')
    const updated = '{"plugin":["opencode-patchline", "added-by-user"]}'
    expect(await uninstallPatchline({
      cwd: root, stdout: () => undefined, stderr: () => undefined,
      confirm: async () => { await writeFile(file, updated); return true },
    })).toBe(1)
    expect(await readFile(file, "utf8")).toBe(updated)
  })

  it("rejects symlink configurations without changing their targets", async () => {
    const root = await workspace()
    const target = path.join(root, "target.json")
    const source = '{"plugin":["opencode-patchline"]}'
    await writeFile(target, source)
    await symlink(target, path.join(root, "opencode.json"), "file")
    expect(await uninstallPatchline({ cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined })).toBe(1)
    expect(await readFile(target, "utf8")).toBe(source)
  })

  it("rejects a symlinked configuration directory before invoking OpenCode", async () => {
    const root = await workspace()
    const outside = await workspace()
    await symlink(outside, path.join(root, ".opencode"), process.platform === "win32" ? "junction" : "dir")
    const calls: string[] = []
    expect(await installPatchline({ cwd: root, stdout: () => undefined, stderr: () => undefined, runCommand: async (command) => { calls.push(command); return 0 } })).toBe(1)
    expect(calls).toEqual([])
  })

  it("records only newly installed dependencies, preserving existing TypeScript", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "package.json"), '{"devDependencies":{"typescript":"^5.9.2"}}')
    const commands: string[][] = []
    expect(await installPatchline({
      cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined,
      hasCommand: async (command) => command === "bun",
      runCommand: async (_command, args) => { commands.push([...args]); return 0 },
    })).toBe(0)
    const state = JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8"))
    expect(state.lspPackages).toEqual(["typescript-language-server"])
    expect(commands.at(-1)).toEqual(["install", "--save-dev", "typescript-language-server"])
  })

  it("does not remove arbitrary packages from a corrupted installer state", async () => {
    const root = await workspace()
    await writeFile(path.join(root, ".opencode-patchline-state.json"), '{"scope":"project","lspPackages":["react", "--force"]}')
    const commands: string[] = []
    expect(await uninstallPatchline({
      cwd: root, yes: true, stdout: () => undefined, stderr: () => undefined,
      runCommand: async (command) => { commands.push(command); return 0 },
    })).toBe(1)
    expect(commands).toEqual([])
  })

  it("removes exact local package registrations saved by the installer", async () => {
    const root = await workspace()
    const packageSpec = path.join(root, "local plugin")
    await mkdir(path.join(packageSpec, "dist"), { recursive: true })
    await writeFile(path.join(packageSpec, "package.json"), '{"name":"opencode-patchline"}')
    for (const entry of ["cli.js", "plugin.js", "tui.js"]) await writeFile(path.join(packageSpec, "dist", entry), "")
    await installPatchline({ cwd: root, packageName: packageSpec, stdout: () => undefined, hasCommand: async () => true, runCommand: async () => 0 })
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["other", packageSpec] }))
    await uninstallPatchline({ cwd: root, yes: true, stdout: () => undefined })
    expect(JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8")).plugin).toEqual(["other"])
  })
  it("recognizes historical local Patchline paths without removing similarly named plugins", () => {
    const source = JSON.stringify({ plugin: ["other", "D:\\Projects\\opencode-patchline", "D:\\Projects\\opencode-patchline\\", "C:\\config\\node_modules\\opencode-patchline", "opencode-patchline-extra"] })
    const result = removePatchlineEntries(source)
    expect(result.removed).toBe(3)
    expect(parse(result.text).plugin).toEqual(["other", "opencode-patchline-extra"])
  })
  it("accepts an existing binary host backup larger than the configuration limit", async () => {
    const { installHostBinary } = await import("../src/installation/files.js")
    const root = await workspace()
    const source = path.join(root, "new.exe")
    const target = path.join(root, "opencode.exe")
    const previous = `${target}.patchline-previous`
    await writeFile(target, Buffer.alloc(2 * 1024 * 1024, 1))
    await writeFile(previous, Buffer.alloc(2 * 1024 * 1024, 2))
    await writeFile(source, Buffer.alloc(2 * 1024 * 1024, 3))
    await expect(installHostBinary(source, target)).resolves.toBe(previous)
    await expect(stat(previous)).resolves.toMatchObject({ size: 2 * 1024 * 1024 })
  })
  it("keeps one previous host and makes identical replacement a no-op", async () => {
    const { installHostBinary } = await import("../src/installation/files.js")
    const root = await workspace()
    const source = path.join(root, "new.exe")
    const target = path.join(root, "opencode.exe")
    await writeFile(target, "stock")
    await writeFile(source, "first")
    const previous = await installHostBinary(source, target)
    expect(await installHostBinary(source, target)).toBe(previous)
    expect(await readFile(previous, "utf8")).toBe("stock")
    await writeFile(source, "second")
    expect(await installHostBinary(source, target)).toBe(previous)
    expect(await readFile(previous, "utf8")).toBe("first")
    expect(await readFile(target, "utf8")).toBe("second")
  })
  it("verifies the committed host binary matches the source", async () => {
    const { installHostBinary } = await import("../src/installation/files.js")
    const root = await workspace()
    const source = path.join(root, "new.exe")
    const target = path.join(root, "opencode.exe")
    await writeFile(source, "patched host")
    await writeFile(target, "stock host")
    const previous = await installHostBinary(source, target)
    expect(await readFile(target, "utf8")).toBe(await readFile(source, "utf8"))
    expect(await readFile(previous, "utf8")).toBe("stock host")
  })

  it("installs a host binary with a backup and refuses linked targets", async () => {
    const { installHostBinary } = await import("../src/installation/files.js")
    const root = await workspace()
    const source = path.join(root, "new.exe")
    const target = path.join(root, "opencode.exe")
    await writeFile(source, "patched host")
    await writeFile(target, "stock host")
    const backup = await installHostBinary(source, target)
    expect(await readFile(target, "utf8")).toBe("patched host")
    expect(await readFile(backup, "utf8")).toBe("stock host")
    const link = path.join(root, "linked.exe")
    try { await symlink(target, link) } catch { return }
    await expect(installHostBinary(source, link)).rejects.toThrow()
    expect(await readFile(target, "utf8")).toBe("patched host")
  })
})
