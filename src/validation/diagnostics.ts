import { spawn } from "node:child_process"
import { PatchlineError } from "../errors.js"

export type DiagnosticsResult = {
  ok: boolean
  command?: string | undefined
  output: string
  exitCode?: number | undefined
}

const MAX_OUTPUT_CHARS = 20_000

export async function terminateProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.pid === undefined) return
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
      const timer = setTimeout(() => { killer.kill(); child.kill(); resolve() }, 2000)
      killer.once("error", () => {
        clearTimeout(timer)
        child.kill()
        resolve()
      })
      killer.once("close", () => { clearTimeout(timer); resolve() })
    })
    return
  }
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    child.kill("SIGKILL")
  }
}

export async function runDiagnosticCommand(command: string, worktree: string, timeoutMs = 120_000, maxLines = 30, signal?: AbortSignal): Promise<DiagnosticsResult> {
  if (!command.trim()) throw new PatchlineError("INVALID_ARGUMENT", "Diagnostic command must not be empty.")
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new PatchlineError("INVALID_ARGUMENT", "Diagnostic timeout must be a positive integer.")
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new PatchlineError("INVALID_ARGUMENT", "Diagnostic line limit must be a positive integer.")
  signal?.throwIfAborted()
  return new Promise<DiagnosticsResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: worktree,
      shell: true,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: process.env,
    })
    let output = ""
    let outputTruncated = false
    let settled = false
    let timedOut = false
    let aborted = false
    const appendOutput = (chunk: string): void => {
      const remaining = MAX_OUTPUT_CHARS - output.length
      if (remaining > 0) output += chunk.slice(0, remaining)
      if (chunk.length > remaining) outputTruncated = true
    }
    const finish = (code?: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      const lines = output.split(/\r?\n/)
      const linesTruncated = lines.length > maxLines
      const bounded = linesTruncated ? lines.slice(0, maxLines).join("\n") : output
      const suffix = outputTruncated || linesTruncated ? "\n... diagnostics truncated" : ""
      const contentLimit = MAX_OUTPUT_CHARS - suffix.length
      resolve({ ok: !timedOut && code === 0, command, output: `${bounded.slice(0, contentLimit)}${suffix}`.trim(), exitCode: code })
    }
    const stop = (reason: "abort" | "timeout"): void => {
      if (settled || timedOut || aborted) return
      timedOut = reason === "timeout"
      aborted = reason === "abort"
      void terminateProcessTree(child).finally(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        if (aborted) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
          reject(signal?.reason instanceof Error ? signal.reason : new DOMException("This operation was aborted", "AbortError"))
        } else {
          finish()
        }
      })
    }
    const abort = (): void => stop("abort")
    const timer = setTimeout(() => stop("timeout"), timeoutMs)
    signal?.addEventListener("abort", abort, { once: true })
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      appendOutput(chunk)
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      appendOutput(chunk)
    })
    child.on("error", (cause) => {
      if (timedOut || aborted) return
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      settled = true
      reject(new PatchlineError("DIAGNOSTICS_UNAVAILABLE", `Could not start diagnostics: ${cause.message}`, { cause }))
    })
    child.on("close", (code) => {
      if (!timedOut && !aborted) finish(code ?? undefined)
    })
  })
}
