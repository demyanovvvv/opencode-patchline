import { mkdtemp, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { PatchlinePlugin } from "../src/plugin.js"
import { runCli } from "../src/cli.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-lsp-integration-"))
  roots.push(root)
  await writeFile(path.join(root, "main.py"), "def example():\n    pass\n")
  return root
}

it("automatically enables native LSP through the plugin config hook without overwriting disables", async () => {
  const root = await fixture()
  const hooks = await PatchlinePlugin({ directory: root, worktree: root } as never, { lspAutoInstall: false })
  const configuration: { lsp?: false | object } = {}
  await hooks.config!(configuration as never)
  expect(configuration.lsp).toEqual({})
  const disabled = { lsp: false as const }
  await hooks.config!(disabled as never)
  expect(disabled.lsp).toBe(false)
})

it("exposes multi-language check through CLI without installing packages", async () => {
  const root = await fixture()
  const output: string[] = []
  const code = await runCli(["lsp", "check", "--directory", root, "--json"], { stdout: (line) => output.push(line) })
  expect(code).toBe(1)
  expect(JSON.parse(output.join(""))).toMatchObject({ projects: [expect.objectContaining({ server: "pyright", verified: false })] })
})

it("exposes LSP preparation state to the agent even when automatic setup is disabled", async () => {
  const root = await fixture()
  const hooks = await PatchlinePlugin({ directory: root, worktree: root } as never, { lspAutoSetup: false })
  expect(hooks.tool?.patchline_lsp_status).toBeDefined()
})
