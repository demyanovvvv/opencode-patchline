import { afterEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runCli } from "../src/cli.js"
import { installPatchline } from "../src/installer.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-installer-cli-"))
  roots.push(root)
  return root
}

describe("installer CLI", () => {
  it("passes language, global scope and yes flags to installation", async () => {
    const root = await workspace()
    const output: string[] = []
    const calls: string[][] = []
    expect(await runCli(["install", "--global", "--language", "ru", "--yes"], {
      stdout: (line) => output.push(line), stderr: () => undefined,
      installer: { cwd: root, stateDirectory: root, hasCommand: async () => true, runCommand: async (_command, args) => { calls.push([...args]); return 0 } },
    })).toBe(0)
    expect(calls).toContainEqual(["plugin", "opencode-patchline", "--global"])
    expect(output.join("\n")).toContain("Установка")
    expect(JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8")).language).toBe("ru")
  })

  it("rejects invalid flags and language before executing anything", async () => {
    for (const args of [["install", "--wat"], ["install", "--lang"], ["install", "--lang", "fr"], ["install", "--dry-run"]]) {
      const calls: string[] = []
      expect(await runCli(args, { stdout: () => undefined, stderr: () => undefined, installer: { runCommand: async (command) => { calls.push(command); return 0 } } })).toBe(1)
      expect(calls).toEqual([])
    }
  })

  it("converts unavailable OpenCode into a localized nonzero result", async () => {
    const root = await workspace()
    const errors: string[] = []
    expect(await installPatchline({ cwd: root, language: "ru", stdout: () => undefined, stderr: (line) => errors.push(line), runCommand: async () => { throw new Error("missing") } })).toBe(1)
    expect(errors.join("\n")).toContain("Ошибка установщика")
  })

  it("rejects unsupported OpenCode before registration", async () => {
    const root = await workspace()
    const calls: string[] = []
    expect(await installPatchline({
      cwd: root, stdout: () => undefined, stderr: () => undefined,
      captureCommand: async () => ({ code: 0, output: "2.0.0" }),
      runCommand: async (command) => { calls.push(command); return 0 },
    })).toBe(1)
    expect(calls).toEqual([])
  })

  it("can install the current built checkout without using the older registry package", async () => {
    const root = await workspace()
    const calls: string[][] = []
    expect(await runCli(["install", "--local", "--lang", "en"], {
      stdout: () => undefined, stderr: () => undefined,
      installer: { cwd: root, hasCommand: async () => true, runCommand: async (_command, args) => { calls.push([...args]); return 0 } },
    })).toBe(0)
    expect(calls[0]?.[1]).not.toBe("opencode-patchline")
    expect(path.isAbsolute(calls[0]![1]!)).toBe(true)
  })

  it("finds the Git root when running uninstall from a subdirectory and reuses Russian", async () => {
    const root = await workspace()
    await mkdir(path.join(root, ".git"))
    await mkdir(path.join(root, ".opencode"))
    await mkdir(path.join(root, "sub"))
    await writeFile(path.join(root, ".opencode", "tui.json"), '{"plugin":["opencode-patchline"]}')
    await writeFile(path.join(root, ".opencode-patchline-state.json"), '{"language":"ru","scope":"project","lspPackages":[]}')
    const output: string[] = []
    expect(await runCli(["uninstall", "--dry-run"], { stdout: (line) => output.push(line), installer: { cwd: path.join(root, "sub") } })).toBe(0)
    expect(output.join("\n")).toContain("Будет удалено")
    expect(output.join("\n")).toContain(path.join(root, ".opencode", "tui.json"))
  })
})