import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { PatchlineError } from "../errors.js"
import { resolveWorkspacePath } from "../workspace/paths.js"

export type LspBridgeOperation = "workspaceSymbol" | "documentSymbol" | "diagnostics"

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
}): Promise<string> {
  const command = await resolveOpenCodeCommand()
  let args: string[]
  if (input.operation === "workspaceSymbol") {
    if (input.query === undefined) throw new PatchlineError("INVALID_ARGUMENT", "query is required for workspaceSymbol.")
    args = ["debug", "lsp", "symbols", input.query, "--pure"]
  } else {
    if (!input.filePath) throw new PatchlineError("INVALID_ARGUMENT", `filePath is required for ${input.operation}.`)
    const resolved = await resolveWorkspacePath(input.worktree, input.filePath)
    if (!resolved.exists) throw new PatchlineError("FILE_NOT_FOUND", `File not found: ${input.filePath}`, { path: input.filePath })
    args = ["debug", "lsp", input.operation === "documentSymbol" ? "document-symbols" : "diagnostics"]
    args.push(input.operation === "documentSymbol" ? pathToFileURL(resolved.absolute).href : resolved.absolute, "--pure")
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: input.worktree, windowsHide: true, shell: false })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (cause) => reject(new PatchlineError("CAPABILITY_UNAVAILABLE", `OpenCode LSP bridge is unavailable: ${cause.message}`, { cause })))
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim() || "[]")
      else reject(new PatchlineError("DIAGNOSTICS_UNAVAILABLE", stderr.trim() || `OpenCode LSP bridge exited with ${code}`))
    })
  })
}
