import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { configureProjectLsp, prepareProjectLsp, type LspEnvironment } from "../src/lsp/manager.js"
import { runLspCommand } from "../src/lsp/process.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture(files: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-lsp-safety-"))
  roots.push(root)
  for (const file of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), "") }
  return root
}
const unavailable: LspEnvironment = { async find() { return undefined }, async npm() { throw new Error("unexpected installation") }, async run() { throw new Error("unexpected command") } }

it("does not install a competing server for a custom server covering the detected extension", async () => {
  const root = await fixture(["main.ts"])
  const configuration = { lsp: { company: { command: ["company-lsp"], extensions: [".ts"] } } }
  const reports = await configureProjectLsp(root, configuration, { environment: unavailable })
  expect(reports[0]?.status).toBe("custom")
  expect(Object.keys(configuration.lsp)).toEqual(["company"])
})

it("does not claim native installation for servers OpenCode cannot install", async () => {
  const root = await fixture(["main.ml", "main.nix", "main.hs", "main.prisma"])
  const env = { ...unavailable, async find(command: string) { return ["opam", "ghc"].includes(command) ? [command] : undefined } }
  const reports = await prepareProjectLsp(root, { environment: env, install: false })
  expect(reports.every((r) => r.status !== "native")).toBe(true)
})

it("shares one managed server installation between nested projects", async () => {
  const root = await fixture(["one/a.html", "two/b.html"])
  let installs = 0
  const reports = await prepareProjectLsp(root, { environment: { ...unavailable, async npm() { installs++; return [process.execPath, "/managed/html.js", "--stdio"] } } })
  expect(installs).toBe(1)
  expect(reports.every((r) => r.status === "configured")).toBe(true)
})

it("times out and cancels preparation processes instead of leaving a hung install", async () => {
  const root = await fixture([])
  await expect(runLspCommand([process.execPath], ["-e", "setInterval(()=>{},1000)"], root, undefined, 50)).rejects.toThrow("timed out")
  const controller = new AbortController()
  const promise = runLspCommand([process.execPath], ["-e", "setInterval(()=>{},1000)"], root, controller.signal)
  controller.abort()
  await expect(promise).rejects.toThrow("cancelled")
})

it("registers non-native servers found on PATH rather than only reporting their executable", async () => {
  const root = await fixture(["index.html"])
  const configuration: Parameters<typeof configureProjectLsp>[1] = {}
  const reports = await configureProjectLsp(root, configuration, { environment: { ...unavailable, async find() { return ["/usr/bin/html-language-server"] } } })
  expect(configuration.lsp).toMatchObject({ html: { command: ["/usr/bin/html-language-server", "--stdio"] } })
  expect(reports[0]?.verified).toBe(false)
})
