import { spawn } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { terminateProcessTree } from "../validation/diagnostics.js"

export type LspHealth = { verified: true; capabilities: Record<string, unknown> }

const MAX_PROBE_HEADER_BYTES = 8_192
const MAX_PROBE_OUTPUT_BYTES = 1_048_576

export async function verifyLspServer(command: readonly string[], cwd: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<LspHealth> {
  options.signal?.throwIfAborted()
  if (!command[0]) throw new Error("LSP command is empty")
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, [...command.slice(1)], { cwd, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] })
    let input: Buffer = Buffer.alloc(0)
    let output = ""
    let outputBytes = 0
    let settled = false
    let stopping = false
    let nextId = 1
    const finish = (error?: Error, result?: LspHealth) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
      void terminateProcessTree(child).then(() => {
        if (error) reject(error)
        else resolve(result!)
      }, reject)
    }
    const stop = (error?: Error) => {
      if (stopping || settled) return
      stopping = true
      finish(error)
    }
    const abort = () => stop(new Error("LSP verification cancelled"))
    const timer = setTimeout(() => stop(new Error("LSP verification timed out")), options.timeoutMs ?? 10_000)
    options.signal?.addEventListener("abort", abort, { once: true })
    const send = (value: unknown) => {
      const body = JSON.stringify(value)
      child.stdin.write(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, "utf8"))
    }
    const processMessages = () => {
      while (true) {
        const split = input.indexOf("\r\n\r\n")
        if (split < 0) {
          if (input.length > MAX_PROBE_HEADER_BYTES) finish(new Error("LSP probe header exceeded its size limit"))
          return
        }
        if (split > MAX_PROBE_HEADER_BYTES) { finish(new Error("LSP probe header exceeded its size limit")); return }
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(input.subarray(0, split).toString("ascii"))
        if (!match) { finish(new Error("LSP server returned an invalid header")); return }
        const length = Number(match[1])
        if (!Number.isSafeInteger(length) || length > MAX_PROBE_OUTPUT_BYTES) { finish(new Error("LSP probe response exceeded its size limit")); return }
        const start = split + 4
        if (input.length - start < length) return
        const body = input.subarray(start, start + length).toString("utf8")
        input = input.subarray(start + length)
        try {
          const message = JSON.parse(body) as { id?: number; result?: { capabilities?: Record<string, unknown> }; error?: unknown }
          if (message.id === requestId) {
            if (message.error || !message.result) { finish(new Error(`LSP initialize failed: ${JSON.stringify(message.error)}`)); return }
            const capabilities = message.result.capabilities
            if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) { finish(new Error("LSP initialize returned invalid capabilities")); return }
            finish(undefined, { verified: true, capabilities })
            return
          }
        } catch { finish(new Error("LSP server returned invalid JSON")); return }
      }
    }
    const requestId = nextId++
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return
      outputBytes += chunk.length
      if (outputBytes > MAX_PROBE_OUTPUT_BYTES) { finish(new Error("LSP probe output exceeded its size limit")); return }
      output = `${output}${chunk.toString()}`.slice(-4_000)
      input = Buffer.concat([input, chunk])
      processMessages()
    })
    child.stderr.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-4_000) })
    child.once("error", (error) => finish(error))
    child.once("close", (code) => { if (!stopping && !settled) finish(new Error(`LSP server exited ${code}: ${output}`)) })
    const rootUri = pathToFileURL(path.resolve(cwd)).href
    send({ jsonrpc: "2.0", id: requestId, method: "initialize", params: { processId: process.pid, rootUri, capabilities: {}, workspaceFolders: [{ uri: rootUri, name: path.basename(path.resolve(cwd)) }] } })
    if (options.signal?.aborted) abort()
  })
}
