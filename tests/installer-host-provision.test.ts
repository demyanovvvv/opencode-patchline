import { expect, it, vi } from "vitest"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { temporaryWorkspace } from "./helpers/workspace.js"

const state = vi.hoisted(() => ({ calls: [] as string[][], config: "", target: "" }))
vi.mock("../src/installation/process.js", () => ({
  async executeCommand(command: string, args: string[]) {
    state.calls.push([command, ...args])
    if (command === state.target && args[0] === "--version") return { code: 0, output: "1.18.34" }
    if (command === "bun") return { code: 1, output: "" }
    if (command === "npm" && args[0] === "ls") return { code: 0, output: '{"dependencies":{}}' }
    if (command === "git") return { code: 1, output: "fixture clone failure" }
    return { code: 0, output: "" }
  },
}))
vi.mock("../src/installation/host-runtime.js", async (original) => {
  const runtime = await original<typeof import("../src/installation/host-runtime.js")>()
  return { ...runtime, findHostBinary: async () => state.target }
})
vi.mock("../src/installation/files.js", async (original) => {
  const files = await original<typeof import("../src/installation/files.js")>()
  return { ...files, globalConfigDirectory: () => state.config }
})

it("rolls back newly provisioned Bun when host preparation later fails", async () => {
  const w = await temporaryWorkspace()
  try {
    state.calls = []
    state.config = path.join(w.path, "config")
    state.target = path.join(w.path, "opencode")
    await mkdir(state.config)
    await writeFile(state.target, "stock")
    await writeFile(path.join(state.config, "opencode.json"), '{"autoupdate":true}')
    const { installPatchline } = await import("../src/installer.js")
    expect(await installPatchline({ cwd: w.path, hostBinary: state.target, yes: true, stdout() {}, stderr() {} })).toBe(1)
    expect(state.calls).toContainEqual(["npm", "install", "--global", "bun"])
    expect(state.calls).toContainEqual(["npm", "uninstall", "--global", "bun"])
  } finally { await w.cleanup() }
})
