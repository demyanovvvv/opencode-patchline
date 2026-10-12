import { spawn } from "node:child_process"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EditService } from "./edit-service.js"
import { decodeUtf8, encodeUtf8 } from "./preservation/text.js"
import { isFileReadResult, ReadService } from "./read-service.js"
import { ScopedSnapshotStore } from "./snapshot/store.js"
import { WriteService } from "./write-service.js"
import { DEFAULT_CONFIG } from "./config.js"
import { supportsOpenCodeVersion } from "./opencode-version.js"
import { terminateProcessTree } from "./validation/diagnostics.js"
import { hostIntegrationStatus } from "./installation/host-runtime.js"

export type CapabilityCheck = {
  name: string
  ok: boolean
  detail: string
  severity?: "required" | "optional" | undefined
}

export async function commandVersion(command: string, args: string[], timeoutMs = 10_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: process.platform === "win32" })
    let output = ""
    let settled = false
    let stopping = false
    const finish = (value?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const stop = (): void => {
      if (stopping || settled) return
      stopping = true
      clearTimeout(timer)
      const cleanup = (): void => { child.stdout.destroy(); child.stderr.destroy(); finish() }
      if (child.pid !== undefined) void terminateProcessTree(child).finally(cleanup)
      else { child.kill("SIGKILL"); cleanup() }
    }
    const timer = setTimeout(stop, timeoutMs)
    const append = (chunk: string): void => {
      if (settled) return
      if (output.length + chunk.length > 16_384) { stop(); return }
      output += chunk
    }
    child.stdout.setEncoding("utf8").on("data", append)
    child.stderr.setEncoding("utf8").on("data", append)
    child.on("error", () => finish())
    child.on("close", (code) => { if (!stopping) finish(code === 0 ? output.trim().split(/\s+/).at(-1) : undefined) })
  })
}

async function lspSetupCheck(): Promise<CapabilityCheck> {
  const flagEnabled = process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL === "true" || process.env.OPENCODE_EXPERIMENTAL === "true"
  const server = await commandVersion("typescript-language-server", ["--version"])
    ?? await commandVersion(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "typescript-language-server", "--version"])
  if (server !== undefined) return { name: "LSP setup", ok: true, detail: `typescript-language-server ${server}` }
  if (flagEnabled) return { name: "LSP setup", ok: true, detail: "OpenCode experimental LSP flag enabled; verify a language server for the project" }
  return { name: "LSP setup", ok: false, detail: "no TypeScript language server found and OpenCode LSP flag is disabled" }
}

async function canImport(specifier: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await import(specifier)
    return { ok: true, detail: "available" }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message.split("\n")[0]! : String(error) }
  }
}

async function hashlineCheck(): Promise<CapabilityCheck> {
  const result = await canImport("@oh-my-pi/hashline")
  if (!result.ok && process.versions.bun === undefined) {
    return { name: "Hashline runtime", ok: true, detail: "Node linear fallback active; full upstream Hashline requires Bun" }
  }
  if (!result.ok) return { name: "Hashline runtime", ...result }
  if (process.versions.bun === undefined) return { name: "Hashline runtime", ok: true, detail: "Node can load parser only; full structural/native adapter requires Bun" }
  const native = await canImport("@oh-my-pi/pi-natives")
  return native.ok
    ? { name: "Hashline runtime", ok: true, detail: "full Bun Hashline and native structural adapter available" }
    : { name: "Hashline runtime", ok: false, detail: `Hashline loaded but native structural adapter failed: ${native.detail}` }
}

async function preservationCheck(): Promise<CapabilityCheck> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "patchline-doctor-"))
  const file = path.join(directory, "crlf-bom.ts")
  try {
    const bytes = encodeUtf8("const ok = true\r\n", true)
    await writeFile(file, bytes)
    const document = decodeUtf8(await readFile(file))
    return {
      name: "CRLF/BOM preservation",
      ok: document.bom && document.lineEnding === "CRLF",
      detail: `${document.lineEnding}, BOM ${document.bom ? "yes" : "no"}`,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function safetyCheck(): Promise<CapabilityCheck> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "patchline-safety-"))
  const file = path.join(directory, "stale.ts")
  try {
    await writeFile(file, "const timeout = 5000\n")
    const snapshots = new ScopedSnapshotStore()
    const observed = await new ReadService(snapshots).read({ sessionId: "doctor", worktree: directory, filePath: "stale.ts" })
     if (!isFileReadResult(observed)) throw new Error("Doctor read unexpectedly returned a directory")
    await writeFile(file, "const timeout = getTimeout()\n")
    let staleRejected = false
    try {
      await new EditService(snapshots).edit({ sessionId: "doctor", worktree: directory, filePath: "stale.ts", snapshot: observed.snapshot, exact: { oldString: "5000", newString: "10000" } })
    } catch (error) {
      staleRejected = error instanceof Error && "code" in error && error.code === "STALE_SNAPSHOT"
    }
    let writeRejected = false
    try {
      await new WriteService(DEFAULT_CONFIG).write({ worktree: directory, filePath: "stale.ts", content: "overwrite\n" })
    } catch (error) {
      writeRejected = error instanceof Error && "code" in error && error.code === "WRITE_PROTECTED"
    }
    const current = await readFile(file, "utf8")
    return {
      name: "Stale/write protection",
      ok: staleRejected && writeRejected && current === "const timeout = getTimeout()\n",
      detail: staleRejected && writeRejected ? "zero overwrite self-test passed" : "self-test failed",
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function inspectCapabilities(): Promise<CapabilityCheck[]> {
  const opencode = await commandVersion("opencode", ["--version"])
  const plugin = await canImport("@opencode-ai/plugin")
  const ast = await canImport("@ast-grep/napi")
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
  await access(process.cwd())
  return [
    { name: "Node.js", severity: "required", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.versions.node },
    { name: "OpenCode", severity: "required", ok: opencode !== undefined && supportsOpenCodeVersion(opencode), detail: opencode === undefined ? "not found" : supportsOpenCodeVersion(opencode) ? opencode : `Unsupported ${opencode}; expected >=1.18.0 <2` },
    { name: "OpenCode plugin SDK", severity: "required", ...plugin },
    { name: "Patchline host integration", severity: "optional", ...hostIntegrationStatus(opencode ?? "not found", manifest.version) },
    { ...(await hashlineCheck()), severity: "optional" },
    { name: "AST search", severity: "optional", ...ast },
    { name: "Text search", severity: "required", ok: true, detail: "built-in bounded fallback" },
    {
      name: "Native LSP tool flag",
      severity: "optional",
      ok: process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL === "true" || process.env.OPENCODE_EXPERIMENTAL === "true",
      detail: process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL === "true" || process.env.OPENCODE_EXPERIMENTAL === "true" ? "enabled" : "optional, disabled",
    },
    { ...(await lspSetupCheck()), severity: "optional" },
    { ...(await preservationCheck()), severity: "required" },
    { ...(await safetyCheck()), severity: "required" },
  ]
}
