import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { temporaryWorkspace } from "./helpers/workspace.js"

const state = vi.hoisted(() => ({ calls: 0, config: "", badVersion: false }))
vi.mock("../src/installation/process.js", () => ({
  async executeCommand(command: string, args: string[]) {
    if (command === "opencode" && args[0] === "--version") return { code: 0, output: state.badVersion ? "2.0.0" : "1.18.34+patchline.1.2.0" }
    if (command === "npm" && args[0] === "view") return { code: 0, output: "1.18.34" }
    if (command === "opencode" && args[0] === "plugin") { state.calls++; return { code: 1, output: "failed" } }
    return { code: 0, output: "" }
  },
}))
vi.mock("../src/installation/files.js", async (original) => {
  const files = await original<typeof import("../src/installation/files.js")>()
  return { ...files, globalConfigDirectory: () => state.config }
})

it("keeps configuration untouched when project preflight fails", async () => {
  const w = await temporaryWorkspace()
  const old = process.env.OPENCODE_CONFIG_DIR
  try {
    state.config = path.join(w.path, "global")
    await mkdir(state.config)
    process.env.OPENCODE_CONFIG_DIR = state.config
    await writeFile(path.join(state.config, "opencode.json"), '{"autoupdate":true}')
    await writeFile(path.join(w.path, "package.json"), "x".repeat(1_048_577))
    expect(await installPatchline({ cwd: w.path, yes: true, stdout() {}, stderr() {} })).toBe(1)
    const { readFile } = await import("node:fs/promises")
    expect(JSON.parse(await readFile(path.join(state.config, "opencode.json"), "utf8")).autoupdate).toBe(true)
  } finally {
    if (old === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = old
    await w.cleanup()
  }
})
import { installPatchline } from "../src/installer.js"

it("restores host configuration when plugin registration returns nonzero", async () => {
  const w = await temporaryWorkspace()
  const old = process.env.OPENCODE_CONFIG_DIR
  try {
    state.config = path.join(w.path, "global")
    await mkdir(state.config)
    process.env.OPENCODE_CONFIG_DIR = state.config
    await writeFile(path.join(state.config, "opencode.json"), '{"autoupdate":true}')
    const result = await installPatchline({ cwd: w.path, yes: true, stdout() {}, stderr() {}, hasCommand: async () => true })
    expect(result).toBe(1)
    const { readFile } = await import("node:fs/promises")
    expect(JSON.parse(await readFile(path.join(state.config, "opencode.json"), "utf8")).autoupdate).toBe(true)
    expect(state.calls).toBe(1)
  } finally {
    if (old === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = old
    await w.cleanup()
  }
})
