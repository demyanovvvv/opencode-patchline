import { spawn } from "node:child_process"
import { terminateProcessTree } from "../validation/diagnostics.js"

export type LspHealth = { verified: true; capabilities: Record<string, unknown> }

export async function verifyLspServer(command: readonly string[], cwd: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<LspHealth> {
  options.signal?.throwIfAborted()
  if (!command[0]) throw new Error("LSP command is empty")
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, [...command.slice(1)], { cwd, shell: false, windowsHide: true, detached: process.platform !== "win32" })
    let input = ""
    let output = ""
    let settled = false
    let stopping = false
    let nextId = 1
    const finish = (error?: Error, result?: LspHealth) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
      if (error) reject(error)
      else resolve(result!)
    }
    const stop = (error?: Error) => {
      if (stopping || settled) return
      stopping = true
      void terminateProcessTree(child).finally(() => finish(error))
    }
    const abort = () => stop(new Error("LSP verification cancelled"))
    const timer = setTimeout(() => stop(new Error("LSP verification timed out")), options.timeoutMs ?? 10_000)
    options.signal?.addEventListener("abort", abort, { once: true })
    const send = (value: unknown) => {
      const body = JSON.stringify(value)
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
    const processMessages = () => {
      while (true) {
        const split = input.indexOf("\r\n\r\n")
        if (split < 0) return
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(input.slice(0, split))
        if (!match) { finish(new Error("LSP server returned an invalid header")); return }
        const length = Number(match[1])
        const start = split + 4
        if (Buffer.byteLength(input.slice(start)) < length) return
        const body = input.slice(start, start + length)
        input = input.slice(start + length)
        try {
          const message = JSON.parse(body) as { id?: number; result?: { capabilities?: Record<string, unknown> }; error?: unknown }
          if (message.id === requestId) {
            if (message.error || !message.result) { finish(new Error(`LSP initialize failed: ${JSON.stringify(message.error)}`)); return }
            finish(undefined, { verified: true, capabilities: message.result.capabilities ?? {} })
            return
          }
        } catch { finish(new Error("LSP server returned invalid JSON")); return }
      }
    }
    const requestId = nextId++
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); input += chunk.toString(); processMessages() })
    child.stderr.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-4_000) })
    child.once("error", (error) => finish(error))
    child.once("close", (code) => { if (!stopping && !settled) finish(new Error(`LSP server exited ${code}: ${output}`)) })
    send({ jsonrpc: "2.0", id: requestId, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {}, workspaceFolders: [{ uri: "file:///workspace", name: "workspace" }] } })
    if (options.signal?.aborted) abort()
  })
}
