import { createServer, request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { performance } from "node:perf_hooks"
import { createHash } from "node:crypto"
import { providerUsage, type Json, type Usage } from "./metrics.js"

export class StreamToolCalls {
  #buffer = ""
  #complete = true
  #bytes = 0
  #calls = new Map<string, { name: string; args: string; argumentFragments: number; emptyArgumentFragments: number; nonStringArgumentFragments: number; missingArgumentFragments: number }>()
  push(chunk: string) {
    if (!this.#complete) return
    this.#bytes += Buffer.byteLength(chunk)
    if (this.#bytes > 2_000_000) { this.#complete = false; this.#buffer = ""; this.#calls.clear(); return }
    this.#buffer += chunk
    const lines = this.#buffer.split("\n")
    this.#buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue
      let event: Json
      try { event = JSON.parse(line.slice(5).trim()) } catch { this.#complete = false; continue }
      if (event && typeof event === "object" && event.choices === undefined && event.usage) continue
      if (!event || !Array.isArray(event.choices)) { this.#complete = false; continue }
      for (const choice of event.choices) {
        if (!choice || (choice.delta?.tool_calls !== undefined && !Array.isArray(choice.delta.tool_calls))) { this.#complete = false; continue }
        for (const delta of choice.delta?.tool_calls ?? []) {
          if (!delta) { this.#complete = false; continue }
          const key = `${choice.index ?? 0}:${delta.index ?? 0}`
          if (!this.#calls.has(key) && this.#calls.size >= 128) { this.#complete = false; continue }
          const call = this.#calls.get(key) ?? { name: "", args: "", argumentFragments: 0, emptyArgumentFragments: 0, nonStringArgumentFragments: 0, missingArgumentFragments: 0 }
          if (typeof delta.function?.name === "string") call.name += delta.function.name
          if (typeof delta.function?.arguments === "string") {
            call.argumentFragments++
            if (!delta.function.arguments.length) call.emptyArgumentFragments++
            call.args += delta.function.arguments
          } else if (delta.function && Object.hasOwn(delta.function, "arguments")) call.nonStringArgumentFragments++
          else call.missingArgumentFragments++
          this.#calls.set(key, call)
        }
      }
    }
  }
  finish(ended = true) {
    if (this.#buffer) this.push("\n")
    return { complete: ended && this.#complete, calls: [...this.#calls.values()].map(({ name, args, ...fragments }) => {
      let value: Json | null = null
      let validJson = false
      try { value = JSON.parse(args); validJson = true } catch { /* Partial or invalid arguments. */ }
      return { name, ...fragments, argumentsBytes: Buffer.byteLength(args), argumentsSha256: createHash("sha256").update(args).digest("hex"), validJson,
        readPathValid: name === "read" ? typeof value?.filePath === "string" && !!value.filePath.trim() : null,
        anchorWithOffset: name === "read" ? value?.anchor !== undefined && value?.offset !== undefined : null }
    }) }
  }
}

export class StreamUsage {
  #buffer = ""
  #usage: Usage | null = null
  push(chunk: string) {
    this.#buffer += chunk
    const lines = this.#buffer.split("\n")
    this.#buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      try { const event = JSON.parse(line.slice(5).trim()); if (event.usage) this.#usage = providerUsage(event.usage) } catch { /* SSE comments / DONE. */ }
    }
    if (this.#buffer.length > 2_000_000) throw new Error("Provider SSE line exceeded measurement budget")
  }
  finish() { if (this.#buffer) this.push("\n"); return this.#usage }
}

export type ProviderCall = { index: number; status: number; durationMs: number; firstByteMs: number | null; usage: Usage | null; requestBytes: number; responseBytes: number; tools: string[]; error: string | null; requestHash: string | null; requestSections: Record<string, number>; messageSections: { systemBytes: number; historyBytes: number; toolResultBytes: number; otherBytes: number; messages: number } | null; responseToolCalls?: ReturnType<StreamToolCalls["finish"]> | null }
export async function createRelay(input: { baseURL: string; apiKey: string; maxRequests: number; timeoutMs: number }) {
  const target = new URL(input.baseURL)
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("Provider baseURL must use HTTP(S)")
  const calls: ProviderCall[] = []
  const active = new Set<ReturnType<typeof httpRequest>>()
  const server = createServer(async (req, res) => {
    const start = performance.now()
    const call: ProviderCall = { index: calls.length, status: 0, durationMs: 0, firstByteMs: null, usage: null, requestBytes: 0, responseBytes: 0, tools: [], error: null, requestHash: null, requestSections: {}, messageSections: null }
    calls.push(call)
    try {
      if (calls.length > input.maxRequests) throw new Error("Provider request limit reached")
      let raw = ""
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8_000_000) throw new Error("Request budget exceeded") }
      const body: Json = JSON.parse(raw)
      call.tools = (body.tools ?? []).map((tool: Json) => String(tool.function?.name ?? tool.name)).sort()
      // OpenAI-compatible streaming providers send actual usage only when requested.
      if (body.stream === true) body.stream_options = { ...body.stream_options, include_usage: true }
      const serialized = JSON.stringify(body)
      call.requestHash = createHash("sha256").update(serialized).digest("hex")
      call.requestSections = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))]))
      if (Array.isArray(body.messages)) {
        const sections = { systemBytes: 0, historyBytes: 0, toolResultBytes: 0, otherBytes: 0, messages: body.messages.length }
        for (const message of body.messages) {
          const role = message?.role
          const key = role === "system" || role === "developer" ? "systemBytes" : role === "tool" ? "toolResultBytes" : role === "user" || role === "assistant" ? "historyBytes" : "otherBytes"
          sections[key] += Buffer.byteLength(JSON.stringify(message))
        }
        call.messageSections = sections
      }
      call.requestBytes = Buffer.byteLength(serialized)
      const url = new URL(`${target.origin}${target.pathname.replace(/\/$/, "")}/${(req.url ?? "").replace(/^\/v1\//, "").replace(/^\//, "")}`)
      const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: req.method ?? "POST", headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}`, accept: req.headers.accept ?? "text/event-stream" },
      }, (response) => {
        call.status = response.statusCode ?? 502
        res.writeHead(call.status, { "content-type": response.headers["content-type"] ?? "application/json", "cache-control": "no-cache" })
        const parser = new StreamUsage()
        const toolCalls = new StreamToolCalls()
        const streaming = String(response.headers["content-type"]).includes("event-stream")
        const decoder = new TextDecoder()
        let json = ""
        response.on("data", (chunk: Buffer) => {
          call.firstByteMs ??= performance.now() - start
          call.responseBytes += chunk.length
          const text = decoder.decode(chunk, { stream: true })
          try {
            if (streaming) { parser.push(text); toolCalls.push(text) }
            else if (json.length < 8_000_000) json += text
          } catch { call.error = "Usage parser limit" }
          if (!res.write(chunk)) { response.pause(); res.once("drain", () => response.resume()) }
        })
        response.once("end", () => {
          if (json) { try { call.usage = providerUsage(JSON.parse(json).usage) } catch { /* Error/non-JSON response. */ } }
          else call.usage = parser.finish()
          Object.assign(call, { responseToolCalls: streaming ? toolCalls.finish() : null })
          call.durationMs = performance.now() - start
          clearTimeout(timer)
          active.delete(upstream)
          res.end()
        })
        response.once("error", () => { Object.assign(call, { responseToolCalls: toolCalls.finish(false) }); call.error = "Upstream stream interrupted"; res.destroy() })
      })
      active.add(upstream)
      const timer = setTimeout(() => upstream.destroy(new Error("Provider timeout")), input.timeoutMs)
      upstream.once("error", () => {
        clearTimeout(timer); active.delete(upstream)
        call.error = "Provider transport failure or timeout"; call.durationMs = performance.now() - start
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: { message: call.error } }))
      })
      res.once("close", () => { if (!res.writableEnded) upstream.destroy() })
      upstream.end(serialized)
    } catch (error) {
      call.error = error instanceof Error ? error.message : "Relay failure"
      call.durationMs = performance.now() - start
      res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: call.error } }))
    }
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Relay failed to listen")
  return { calls, url: `http://127.0.0.1:${address.port}/v1`, close: async () => {
    for (const request of active) request.destroy()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  } }
}
