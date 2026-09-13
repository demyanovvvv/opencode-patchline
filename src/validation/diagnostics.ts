import { spawn } from "node:child_process"
import { PatchlineError } from "../errors.js"

export type DiagnosticsResult = {
  ok: boolean
  command?: string | undefined
  output: string
  exitCode?: number | undefined
}

export async function runDiagnosticCommand(command: string, worktree: string, timeoutMs = 120_000, maxLines = 30): Promise<DiagnosticsResult> {
  if (!command.trim()) throw new PatchlineError("INVALID_ARGUMENT", "Diagnostic command must not be empty.")
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new PatchlineError("INVALID_ARGUMENT", "Diagnostic line limit must be a positive integer.")
  return new Promise<DiagnosticsResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: worktree,
      shell: true,
      windowsHide: true,
      env: process.env,
    })
    let output = ""
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk
    })
    child.on("error", (cause) => {
      clearTimeout(timer)
      reject(new PatchlineError("DIAGNOSTICS_UNAVAILABLE", `Could not start diagnostics: ${cause.message}`, { cause }))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const lines = output.split(/\r?\n/)
      const lineLimited = lines.length > maxLines ? `${lines.slice(0, maxLines).join("\n")}\n... diagnostics truncated` : output
      const bounded = lineLimited.length > 20_000 ? `${lineLimited.slice(0, 20_000)}\n... diagnostics truncated` : lineLimited
      resolve({ ok: code === 0, command, output: bounded.trim(), exitCode: code ?? undefined })
    })
  })
}
