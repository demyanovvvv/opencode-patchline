import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { PatchlineError } from "../errors.js"
import { resolveWorkspacePath } from "../workspace/paths.js"

export type LspBridgeOperation = "workspaceSymbol" | "documentSymbol" | "diagnostics"

const MAX_OUTPUT_CHARS = 200_000
const MAX_ERROR_CHARS = 4_000
const LSP_TIMEOUT_MS = 30_000
const LSP_RECOVERY = "Enable OpenCode LSP and install a language server; use ast_search for structure or patchline_grep for literal text as fallback."

function boundedErrorDetail(detail: string): string {
  const normalized = detail.trim()
  if (normalized.length <= MAX_ERROR_CHARS) return normalized
  return `${normalized.slice(0, MAX_ERROR_CHARS - 28)}\n... LSP detail truncated`
}

export function interpretLspOutput(operation: LspBridgeOperation, stdout: string, stderr: string, exitCode: number): string {
  const diagnostics = stderr.trim()
  if (exitCode !== 0) {
    throw new PatchlineError("DIAGNOSTICS_UNAVAILABLE", boundedErrorDetail(diagnostics || `OpenCode LSP bridge exited with ${exitCode}`))
  }
  if (/\b(?:all\s+)?LSPs?\s+are\s+disabled\b|no\s+LSP\s+(?:servers?|configur)/i.test(diagnostics)) {
    throw new PatchlineError("CAPABILITY_UNAVAILABLE", boundedErrorDetail(`OpenCode LSP is unavailable for ${operation}: ${diagnostics}\n${LSP_RECOVERY}`))
  }
  return stdout.trim() || "[]"
}

export function buildLspArgs(operation: LspBridgeOperation, target: string): string[] {
  const command = operation === "workspaceSymbol" ? "symbols" : operation === "documentSymbol" ? "document-symbols" : "diagnostics"
  return ["debug", "lsp", command, target, "--pure", "--print-logs", "--log-level", "INFO"]
}

async function resolveOpenCodeCommand(): Promise<string> {
  if (process.platform !== "win32") return "opencode"

  const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
  const candidates = entries.flatMap((entry) => [
    path.join(entry, "opencode.exe"),
    path.join(entry, "node_modules", "opencode-ai", "bin", "opencode.exe"),
  ])
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Keep looking through PATH entries.
    }
  }
  throw new PatchlineError("CAPABILITY_UNAVAILABLE", "OpenCode executable could not be resolved without invoking a shell.")
}

export async function runOpenCodeLspBridge(input: {
  worktree: string
  operation: LspBridgeOperation
  query?: string | undefined
  filePath?: string | undefined
  signal?: AbortSignal | undefined
}): Promise<string> {
  input.signal?.throwIfAborted()
  const command = await resolveOpenCodeCommand()
  let args: string[]
  if (input.operation === "workspaceSymbol") {
    if (input.query === undefined) throw new PatchlineError("INVALID_ARGUMENT", "query is required for workspaceSymbol.")
     args = buildLspArgs(input.operation, input.query)
  } else {
    if (!input.filePath) throw new PatchlineError("INVALID_ARGUMENT", `filePath is required for ${input.operation}.`)
    const resolved = await resolveWorkspacePath(input.worktree, input.filePath)
    if (!resolved.exists) throw new PatchlineError("FILE_NOT_FOUND", `File not found: ${input.filePath}`, { path: input.filePath })
     args = buildLspArgs(input.operation, input.operation === "documentSymbol" ? pathToFileURL(resolved.absolute).href : resolved.absolute)
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: input.worktree, windowsHide: true, shell: false, signal: input.signal })
    let stdout = ""
    let stderr = ""
    let settled = false
    const append = (current: string, chunk: string): string => current.length >= MAX_OUTPUT_CHARS
      ? current
      : `${current}${chunk.slice(0, MAX_OUTPUT_CHARS - current.length)}`
    const cleanup = (): void => {
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", abort)
    }
    const abort = (): void => {
      child.stdout.destroy()
      child.stderr.destroy()
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      child.stdout.destroy()
      child.stderr.destroy()
      if (settled) return
      settled = true
      cleanup()
      reject(new PatchlineError("DIAGNOSTICS_UNAVAILABLE", "OpenCode LSP bridge timed out."))
    }, LSP_TIMEOUT_MS)
    input.signal?.addEventListener("abort", abort, { once: true })
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = append(stderr, chunk)
    })
    child.on("error", (cause) => {
      if (settled) return
      settled = true
      cleanup()
      if (cause.name === "AbortError") reject(cause)
       else reject(new PatchlineError("CAPABILITY_UNAVAILABLE", boundedErrorDetail(`OpenCode LSP bridge is unavailable: ${cause.message}`), { cause }))
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      cleanup()
       try {
         resolve(interpretLspOutput(input.operation, stdout, stderr, code ?? -1))
       } catch (error) {
         reject(error)
       }
    })
  })
}
