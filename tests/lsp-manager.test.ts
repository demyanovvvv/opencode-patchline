import { access, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { configureProjectLsp, prepareProjectLsp, type LspConfiguration, type LspEnvironment } from "../src/lsp/manager.js"

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

it("preserves configuration disabled while preparation is awaiting discovery", async () => {
  const root = await fixture("main.ts")
  const configuration: LspConfiguration = { lsp: true }
  const environment: LspEnvironment = { ...unavailable, async find() { configuration.lsp = false; return undefined } }
  await configureProjectLsp(root, configuration, { environment, install: false })
  expect(configuration.lsp).toBe(false)
})

it("discards reports when configuration is edited in place during discovery", async () => {
  const root = await fixture("main.ts")
  const servers = { typescript: { disabled: false } }
  const configuration: LspConfiguration = { lsp: servers }
  const environment: LspEnvironment = { ...unavailable, async find() { servers.typescript.disabled = true; return undefined } }
  const reports = await configureProjectLsp(root, configuration, { environment, install: false })
  expect(configuration.lsp).toBe(servers)
  expect(servers.typescript.disabled).toBe(true)
  expect(reports).toEqual([])
})

it("does not start managed installation after discovery disables LSP", async () => {
  const root = await fixture("main.ts")
  const configuration: LspConfiguration = { lsp: true }
  let installations = 0
  const environment: LspEnvironment = {
    ...unavailable,
    async find() { configuration.lsp = false; return undefined },
    async npm() { installations++; return ["unused-server"] },
  }
  expect(await prepareProjectLsp(root, { configuration, environment })).toEqual([])
  expect(installations).toBe(0)
})

it("discards missing-toolchain reports after runtime discovery changes configuration", async () => {
  const root = await fixture("main.go")
  const configuration: LspConfiguration = { lsp: true }
  const commands: string[] = []
  const environment: LspEnvironment = { ...unavailable, async find(command) {
    commands.push(command)
    if (command === "go") configuration.lsp = false
    return undefined
  } }
  expect(await prepareProjectLsp(root, { configuration, environment })).toEqual([])
  expect(commands).toEqual(["gopls", "go"])
})

it("does not verify an installed command after its installer disables configuration", async () => {
  const root = await fixture("main.ts")
  const marker = path.join(root, "unexpected-probe")
  const configuration: LspConfiguration = { lsp: true }
  let installations = 0
  const environment: LspEnvironment = { ...unavailable, async npm() {
    installations++
    configuration.lsp = false
    return [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); process.exit(99)`]
  } }
  expect(await prepareProjectLsp(root, { configuration, environment })).toEqual([])
  expect(installations).toBe(1)
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" })
})

it("does not repeat a failed server installation across project roots but retries on the next preparation", async () => {
  const root = await fixture("main.ts")
  for (const name of ["a", "b"]) {
    await mkdir(path.join(root, name))
    await writeFile(path.join(root, name, "tsconfig.json"), "{}")
    await writeFile(path.join(root, name, "main.ts"), "")
  }
  let attempts = 0
  let repaired = false
  const environment: LspEnvironment = { ...unavailable, async npm(_packages, recipe) {
    if (recipe.id === "typescript") {
      attempts++
      if (repaired) return ["managed-typescript-server", "--stdio"]
    }
    throw new Error("registry unavailable")
  } }
  const first = (await prepareProjectLsp(root, { environment })).filter((report) => report.server === "typescript")
  expect(first).toHaveLength(3)
  expect(first.every((report) => report.status === "failed" && !report.verified && report.detail === "registry unavailable")).toBe(true)
  expect(attempts).toBe(1)
  repaired = true
  const recovered = (await prepareProjectLsp(root, { environment })).filter((report) => report.server === "typescript")
  expect(attempts).toBe(2)
  expect(recovered).toHaveLength(3)
  expect(recovered.every((report) => report.status === "configured" && !report.verified && report.command?.[0] === "managed-typescript-server")).toBe(true)
})

it("leaves explicit global and server disables intact without installing", async () => {
  const root = await fixture("main.ts")
  const disabled = { lsp: false as const }
  expect(await configureProjectLsp(root, disabled, { environment: unavailable })).toEqual([])
  expect(disabled.lsp).toBe(false)
  const config = { lsp: { typescript: { disabled: true as const } } }
  expect((await configureProjectLsp(root, config, { environment: unavailable }))[0]?.status).toBe("disabled")
  expect(config.lsp.typescript).toEqual({ disabled: true })
})

it("propagates cancellation during executable discovery without installing", async () => {
  const root = await fixture("main.ts")
  const controller = new AbortController()
  let installations = 0
  const environment: LspEnvironment = {
    ...unavailable,
    async find() { controller.abort(); throw controller.signal.reason },
    async npm() { installations++; return ["unexpected"] },
  }
  await expect(prepareProjectLsp(root, { environment, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  expect(installations).toBe(0)
})

it("does not report a cancelled existing-server probe as configured", async () => {
  const root = await fixture("main.ts")
  const controller = new AbortController()
  const environment: LspEnvironment = {
    ...unavailable,
    async find() { controller.abort(); return [process.execPath] },
  }
  await expect(prepareProjectLsp(root, { environment, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
})

it("stops after discovery returns unavailable with a cancelled signal", async () => {
  const root = await fixture("main.ts")
  const controller = new AbortController()
  let discoveries = 0
  let installations = 0
  const environment: LspEnvironment = {
    ...unavailable,
    async find() { discoveries++; controller.abort(); return undefined },
    async npm() { installations++; throw new Error("must not install") },
  }
  await expect(prepareProjectLsp(root, { environment, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  expect(discoveries).toBe(1)
  expect(installations).toBe(0)
})

it("propagates cancellation from runtime discovery before reporting missing toolchain", async () => {
  const root = await fixture("main.go")
  const controller = new AbortController()
  const commands: string[] = []
  const environment: LspEnvironment = {
    ...unavailable,
    async find(command) { commands.push(command); if (command === "go") controller.abort(); return undefined },
  }
  await expect(prepareProjectLsp(root, { environment, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  expect(commands).toEqual(["gopls", "go"])
})

it("does not report a managed command returned after cancellation as configured", async () => {
  const root = await fixture("main.ts")
  const controller = new AbortController()
  let installations = 0
  const environment: LspEnvironment = {
    ...unavailable,
    async npm() { installations++; controller.abort(); return ["cancelled-server"] },
  }
  await expect(prepareProjectLsp(root, { environment, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  expect(installations).toBe(1)
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
