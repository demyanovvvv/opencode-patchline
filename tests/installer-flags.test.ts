import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runCli } from "../src/cli.js"
import { installerArguments } from "../src/installation/arguments.js"
import { fileURLToPath } from "node:url"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-flags-")))
  roots.push(root)
  return root
}

describe("installation argument contract", () => {
  it("preserves the --local source alias alongside global scope", () => {
    expect(installerArguments("install", ["--local", "--global"]).options).toMatchObject({
      packageName: fileURLToPath(new URL("..", import.meta.url)), global: true,
    })
  })
  it.each(["install", "uninstall"])("shows %s help without touching the installation", async (action) => {
    const lines: string[] = []
    expect(await runCli([action, "--help", "--lang=ru"], {
      stdout: (line) => lines.push(line), stderr: () => undefined,
      installer: { cwd: "missing-directory", runCommand: async () => { throw new Error("Unexpected execution") } },
    })).toBe(0)
    expect(lines.join("\n")).toContain("--cwd")
    expect(lines.join("\n")).toContain(action === "install" ? "--no-host" : "--restore-host")
  })

  it.each([
    ["install", "--project", "--global"], ["install", "--lang", "en", "--language=ru"],
    ["install", "--cwd"], ["install", "--cwd="], ["install", "--yes=true"],
    ["install", "--local", "--package", "."], ["install", "--yes", "-y"],
    ["uninstall", "--no-host"], ["install", "--keep-deps"], ["uninstall", "--package", "."],
  ])("rejects malformed or contradictory flags: %j", async (...args) => {
    const calls: string[] = []
    expect(await runCli(args, { stdout: () => undefined, stderr: () => undefined,
      installer: { runCommand: async (command) => { calls.push(command); return 0 } },
    })).toBe(1)
    expect(calls).toEqual([])
  })

  it("uses an explicit project and equals-style values without changing the caller cwd", async () => {
    const root = await workspace()
    const before = process.cwd()
    const calls: string[][] = []
    expect(await runCli(["install", "--project", `--cwd=${root}`, "--language=ru", "-y"], {
      stdout: () => undefined, stderr: () => undefined,
      installer: { hasCommand: async () => true, runCommand: async (_command, args) => { calls.push([...args]); return 0 } },
    })).toBe(0)
    expect(calls).toContainEqual(["plugin", "opencode-patchline"])
    expect(JSON.parse(await readFile(path.join(root, ".opencode-patchline-state.json"), "utf8"))).toMatchObject({ scope: "project", language: "ru" })
    expect(process.cwd()).toBe(before)
  })
})
