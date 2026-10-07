import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createSmokeEnvironment } from "./smoke-environment.mjs"

const execute = promisify(execFile)
const root = await mkdtemp(path.join(os.tmpdir(), "patchline-native-session-"))
let child
let index = 0
const failures = []
const patch = (old) => `*** Begin Patch\n*** Update File: first.txt\n@@\n-before\n+after\n*** Update File: second.txt\n@@\n-${old}\n+after\n*** End Patch`
const steps = [["apply_patch", { patchText: patch("missing") }], ["read", { filePath: "second.txt", offset: 1, limit: 5 }], ["apply_patch", { patchText: patch("before") }], ["patchline_summary", {}]]
const provider = createServer(async (request, response) => {
  try {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    const main = body.tools?.some((tool) => tool.function?.name === "apply_patch")
    const current = main ? index++ : -1
    if (current === 1) {
      assert.equal(await readFile(path.join(root, "first.txt"), "utf8"), "before\n")
      assert.equal(await readFile(path.join(root, "second.txt"), "utf8"), "before\n")
      assert.match(JSON.stringify(body.messages), /Failed to find expected lines|context does not match/i)
    }
    const step = main ? steps[current] : undefined
    if (step) assert.ok(body.tools.some((tool) => tool.function?.name === step[0]))
    response.writeHead(200, { "content-type": "text/event-stream" })
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: `completion-${current}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    send({ role: "assistant" })
    if (step) {
      send({ tool_calls: [{ index: 0, id: `fixture-call-${current}`, type: "function", function: { name: step[0], arguments: JSON.stringify(step[1]) } }] })
      send({}, "tool_calls")
    } else { send({ content: "Controlled fixture complete." }); send({}, "stop") }
    response.end("data: [DONE]\n\n")
  } catch (error) { failures.push(error.message); response.writeHead(500); response.end(error.message) }
})
const reservation = createServer()
try {
  await writeFile(path.join(root, "first.txt"), "before\n")
  await writeFile(path.join(root, "second.txt"), "before\n")
  await writeFile(path.join(root, ".gitignore"), "config/\ndata/\ncache/\nstate/\n")
  await execute("git", ["init", "--initial-branch=main"], { cwd: root })
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const environment = createSmokeEnvironment(root)
  environment.OPENCODE_CONFIG_CONTENT = JSON.stringify({ plugin: [fileURLToPath(new URL("../dist/plugin.js", import.meta.url))], permission: "allow", enabled_providers: ["fixture"], provider: { fixture: { name: "Controlled session fixture", npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: "fixture" }, models: { fixture: { name: "fixture", limit: { context: 64000, output: 4000 } } } } } })
  child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env: environment, shell: process.platform === "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  let logs = ""
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk).slice(-8000) })
  const url = `http://127.0.0.1:${port}`
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(logs)
    try { ready = (await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(1000) })).ok } catch { /* Startup. */ }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(ready, logs)
  const create = await fetch(`${url}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  assert.ok(create.ok, await create.clone().text())
  const session = await create.json()
  const prompt = await fetch(`${url}/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Run the controlled native recovery fixture." }] }), signal: AbortSignal.timeout(120000) })
  assert.ok(prompt.ok, await prompt.clone().text())
  await prompt.text()
  assert.deepEqual(failures, [])
  const messagesResponse = await fetch(`${url}/session/${session.id}/message`)
  assert.ok(messagesResponse.ok)
  const messages = await messagesResponse.json()
  const tools = messages.flatMap((message) => message.parts ?? []).filter((part) => part.type === "tool")
  const diagnostic = JSON.stringify(tools.map((part) => ({ tool: part.tool, status: part.state.status, error: part.state.error, metadata: part.state.metadata }))).slice(-4000)
  assert.ok(tools.some((part) => part.tool === "apply_patch" && part.state.status === "error"), diagnostic)
  assert.ok(tools.some((part) => part.tool === "read" && part.state.status === "completed"), diagnostic)
  assert.ok(tools.some((part) => part.tool === "apply_patch" && part.state.status === "completed"), diagnostic)
  const summary = tools.find((part) => part.tool === "patchline_summary" && part.state.status === "completed")
  assert.ok(summary, diagnostic)
  assert.equal(summary.state.metadata.summary.nativePatchContextMismatches, 1, diagnostic)
  assert.equal(await readFile(path.join(root, "first.txt"), "utf8"), "after\n")
  assert.equal(await readFile(path.join(root, "second.txt"), "utf8"), "after\n")
  console.log("Native session smoke passed: host tool loop, multi-file no-write mismatch, fresh read, recovery and event counter (controlled provider).")
} finally {
  if (child?.pid && child.exitCode === null) {
    if (process.platform === "win32") await execute("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"]).catch(() => {})
    else child.kill("SIGTERM")
  }
  await new Promise((resolve) => provider.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
