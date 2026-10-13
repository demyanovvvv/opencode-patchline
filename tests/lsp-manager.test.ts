import { mkdtemp, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { configureProjectLsp, prepareProjectLsp, type LspEnvironment } from "../src/lsp/manager.js"

const roots: string[] = []
async function fixture(file: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-lsp-manager-"))
  roots.push(root)
  await writeFile(path.join(root, file), "")
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const unavailable: LspEnvironment = {
  async find() { return undefined },
  async npm() { throw new Error("unexpected installation") },
  async run() { throw new Error("unexpected toolchain command") },
}

it("leaves explicit global and server disables intact without installing", async () => {
  const root = await fixture("main.ts")
  const disabled = { lsp: false as const }
  expect(await configureProjectLsp(root, disabled, { environment: unavailable })).toEqual([])
  expect(disabled.lsp).toBe(false)
  const config = { lsp: { typescript: { disabled: true as const } } }
  expect((await configureProjectLsp(root, config, { environment: unavailable }))[0]?.status).toBe("disabled")
  expect(config.lsp.typescript).toEqual({ disabled: true })
})

it("installs TypeScript in managed storage and registers an absolute command without changing project files", async () => {
  const root = await fixture("main.ts")
  const requested: string[][] = []
  const environment: LspEnvironment = { ...unavailable, async npm(packages) { requested.push(packages); return [process.execPath, "/managed/typescript-language-server/cli.mjs", "--stdio"] } }
  const config: Parameters<typeof configureProjectLsp>[1] = {}
  const result = await configureProjectLsp(root, config, { environment })
  expect(requested).toEqual([["typescript@5.9.3", "typescript-language-server@4.3.4"]])
  expect(result[0]?.status).toBe("configured")
  expect(config.lsp).toMatchObject({ typescript: { command: [process.execPath, "/managed/typescript-language-server/cli.mjs", "--stdio"] } })
})

it("reports native installation as deferred rather than claiming the server is ready", async () => {
  const root = await fixture("main.py")
  const result = await prepareProjectLsp(root, { environment: unavailable })
  expect(result[0]).toMatchObject({ server: "pyright", status: "native", verified: false })
})

it("preserves custom commands and honors download-disabled for managed installs", async () => {
  const root = await fixture("main.ts")
  const config = { lsp: { typescript: { command: ["my-lsp", "--stdio"], extensions: [".ts"] } } }
  expect((await configureProjectLsp(root, config, { environment: unavailable }))[0]?.status).toBe("custom")
  expect(config.lsp.typescript.command).toEqual(["my-lsp", "--stdio"])
  const reports = await prepareProjectLsp(root, { environment: unavailable, install: false })
  expect(reports[0]?.status).toBe("missing")
})

it("installs rust-analyzer with an existing rustup and verifies the resulting executable", async () => {
  const root = await fixture("main.rs")
  const calls: string[][] = []
  let installed = false
  const environment: LspEnvironment = { ...unavailable,
    async find(command) { return command === "rustup" || command === "cargo" ? [command] : command === "rust-analyzer" && installed ? [command] : undefined },
    async run(command, args) { calls.push([...command, ...args]); installed = true },
  }
  const reports = await prepareProjectLsp(root, { environment })
  expect(calls).toEqual([["rustup", "component", "add", "rust-analyzer"]])
  expect(reports[0]).toMatchObject({ server: "rust", status: "configured", verified: false })
})

it("continues preparing other languages after a failed installation", async () => {
  const root = await fixture("main.ts")
  await writeFile(path.join(root, "main.py"), "")
  const results = await prepareProjectLsp(root, { environment: unavailable })
  expect(results.find((r) => r.server === "typescript")?.status).toBe("failed")
  expect(results.find((r) => r.server === "pyright")?.status).toBe("native")
})
