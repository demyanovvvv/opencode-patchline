import { spawn } from "node:child_process"
import { access, stat } from "node:fs/promises"
import path from "node:path"
import { terminateProcessTree } from "../validation/diagnostics.js"

export async function findExecutable(name: string): Promise<string[] | undefined> {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("Invalid LSP executable name")
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    if (process.platform === "win32" && name === "npm") {
      const cli = path.join(directory, "node_modules", "npm", "bin", "npm-cli.js")
      try { await access(cli); return [process.execPath, cli] } catch { /* continue */ }
    }
    for (const suffix of process.platform === "win32" ? [".exe"] : [""]) {
      const file = path.resolve(directory, name + suffix)
      try { if ((await stat(file)).isFile()) { await access(file); return [file] } } catch { /* continue */ }
    }
  }
  return undefined
}

export async function runLspCommand(command: readonly string[], args: readonly string[], cwd: string, signal?: AbortSignal, timeoutMs = 180_000): Promise<string> {
  signal?.throwIfAborted()
  if (!command[0]) throw new Error("LSP command is empty")
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, [...command.slice(1), ...args], { cwd, shell: false, windowsHide: true, detached: process.platform !== "win32", env: { ...process.env } })
    let output = ""
    let settled = false
    let stopping = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      if (error) reject(error)
      else resolve(output)
    }
    const stop = (error: Error) => {
      if (settled || stopping) return
      stopping = true
      void terminateProcessTree(child).finally(() => finish(error))
    }
    const abort = () => stop(new Error("LSP preparation cancelled"))
    const timer = setTimeout(() => stop(new Error("LSP preparation timed out")), timeoutMs)
    signal?.addEventListener("abort", abort, { once: true })
    const append = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-8_000) }
    child.stdout.on("data", append)
    child.stderr.on("data", append)
    child.once("error", (error) => finish(error))
    child.once("close", (code) => { if (!stopping) finish(code === 0 ? undefined : new Error(`LSP command exited ${code}: ${output}`)) })
    if (signal?.aborted) abort()
  })
}
