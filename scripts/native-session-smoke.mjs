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
const compact = process.argv.includes("--compact")
const patch = (old) => `*** Begin Patch\n*** Update File: first.txt\n@@\n-before\n+after\n*** Update File: second.txt\n@@\n-${old}\n+after\n*** End Patch`
const steps = [...compact ? [["read", {}], ["read", { filePath: "second.txt", anchor: "before", offset: 1, limit: 5 }]] : [], ["apply_patch", { patchText: patch("missing") }], ["read", { filePath: "second.txt", ...compact ? { anchor: "before", limit: 5 } : { offset: 1, limit: 5 } }], ["apply_patch", { patchText: patch("before") }], ...compact ? [["read", { filePath: "exact.txt", anchor: "original", limit: 5 }], ["edit", {}]] : [["patchline_summary", {}]]]
const provider = createServer(async (request, response) => {
  try {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    if (process.argv.includes("--serial-tools")) assert.equal(body.parallel_tool_calls, false, "Host did not forward serial tool-call option")
    const main = body.tools?.some((tool) => tool.function?.name === "apply_patch")
    if (compact && main) {
      const system = body.messages.filter((message) => message.role === "system").map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n")
      assert.ok(system.includes('read({"filePath":"src/main.ts","anchor":"function main","limit":40}) replaces grep then read'), "Compact anchor policy did not reach provider system messages")
      const names = body.tools.map((tool) => tool.function?.name)
      for (const hidden of ["patchline_execute", "patchline_apply_patch", "patchline_route_search", "patchline_lsp_status", "patchline_summary"]) assert.ok(!names.includes(hidden), `Compact exposed ${hidden}`)
      assert.equal(new Set(names).size, names.length, "Duplicate model tool names")
      const edit = body.tools.find((tool) => tool.function?.name === "edit").function.parameters
      assert.ok(edit.required.includes("snapshot"), "Compact edit lost required snapshot")
      assert.ok(edit.properties.oldString && edit.properties.newString, "Compact exact edit fields missing")
      assert.ok(!("hashlinePatch" in edit.properties), "Compact exposed hashline input")
       const read = body.tools.find((tool) => tool.function?.name === "read").function.parameters
       assert.ok(read.properties.anchor && read.properties.limit, "Anchor read fields missing from provider schema")
       assert.ok(read.required?.includes("filePath"), "Provider read schema lost required filePath")
       assert.equal(read.properties.filePath.type, "string", "Provider read filePath is not a string")
    }
    if (main) {
      const readTool = body.tools.find((tool) => tool.function?.name === "read")?.function
      assert.ok(readTool, "Provider read tool missing")
      assert.deepEqual(readTool.parameters.not, { required: ["anchor", "offset"] }, "Provider read schema lost selector exclusion")
      assert.ok(readTool.description.includes('"filePath":"src/main.ts","offset":1,"limit":80'), "Provider read description lost offset example")
      assert.ok(readTool.description.includes('"anchor":"function main"'), "Provider read description lost anchor example")
      assert.match(readTool.parameters.properties.offset.description, /Omit this property entirely when using anchor/)
      assert.match(readTool.parameters.properties.anchor.description, /Omit this property entirely when using offset/)
    }
    const position = main ? index++ : -1
    const current = compact && position >= 0 ? position - 2 : position
    if (current === 1) {
      assert.equal(await readFile(path.join(root, "first.txt"), "utf8"), "before\n")
      assert.equal(await readFile(path.join(root, "second.txt"), "utf8"), "before\n")
      assert.match(JSON.stringify(body.messages), /Failed to find expected lines|context does not match/i)
    }
    const step = main ? steps[position] : undefined
    const snapshotFor = (file) => {
      const output = body.messages.flatMap((message) => message.role === "tool" ? [message.content] : []).filter((content) => typeof content === "string").findLast((content) => content.includes(`Path: ${file}`))
      const snapshot = /Snapshot: (\S+)/.exec(output ?? "")?.[1]
      assert.ok(snapshot, `Snapshot missing for ${file}`)
      return snapshot
    }
    if (compact && current === 4) {
      const readResult = body.messages.flatMap((message) => message.role === "tool" ? [message.content] : []).filter((content) => typeof content === "string").findLast((content) => content.includes("Path: exact.txt"))
      const snapshot = /Snapshot: (\S+)/.exec(readResult ?? "")?.[1]
      assert.ok(snapshot, "Snapshot missing from actual provider tool-result history")
      step[1] = { filePath: "exact.txt", snapshot, oldString: "original", newString: "updated" }
    }
    if (compact && (current === 7 || current === 8)) {
      if (current === 8) {
        assert.equal(await readFile(path.join(root, "batch-a.txt"), "utf8"), "original\n")
        assert.equal(await readFile(path.join(root, "batch-b.txt"), "utf8"), "original\n")
      }
      step[1] = { edits: ["batch-a.txt", "batch-b.txt"].map((filePath, i) => ({ filePath, snapshot: snapshotFor(filePath), oldString: current === 7 && i === 1 ? "missing" : "original", newString: "updated" })) }
    }
    if (compact && current === 9) {
      step[1] = { edits: ["batch-a.txt", "batch-b.txt"].map((filePath) => ({ filePath, snapshot: snapshotFor(filePath), oldString: "updated", newString: "stale overwrite" })) }
    }
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
  if (compact) {
    for (const file of ["exact.txt", "batch-a.txt", "batch-b.txt"]) await writeFile(path.join(root, file), "original\n")
    steps.push(["read", { filePath: "batch-a.txt", anchor: "original", limit: 5 }], ["read", { filePath: "batch-b.txt", anchor: "original", limit: 5 }], ["patchline_edit_batch", {}], ["patchline_edit_batch", {}], ["patchline_edit_batch", {}])
  }
  await writeFile(path.join(root, ".gitignore"), "config/\ndata/\ncache/\nstate/\n")
  await execute("git", ["init", "--initial-branch=main"], { cwd: root })
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const environment = createSmokeEnvironment(root)
  environment.OPENCODE_CONFIG_CONTENT = JSON.stringify({ plugin: [[fileURLToPath(new URL("../dist/plugin.js", import.meta.url)), { toolProfile: compact ? "compact" : "extended", lspAutoSetup: false, lspAutoInstall: false }]], lsp: false, permission: "allow", enabled_providers: ["fixture"], provider: { fixture: { name: "Controlled session fixture", npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: "fixture" }, models: { "gpt-5": { name: "gpt-5", limit: { context: 64000, output: 4000 } } } } } })
  if (process.argv.includes("--serial-tools")) {
    const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT)
    config.provider.fixture.models["gpt-5"].options = { parallel_tool_calls: false }
    environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
  }
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
  const prompt = await fetch(`${url}/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: { providerID: "fixture", modelID: "gpt-5" }, parts: [{ type: "text", text: "Run the controlled native recovery fixture." }] }), signal: AbortSignal.timeout(120000) })
  assert.ok(prompt.ok, await prompt.clone().text())
  await prompt.text()
  assert.deepEqual(failures, [])
  const messagesResponse = await fetch(`${url}/session/${session.id}/message`)
  assert.ok(messagesResponse.ok)
  const messages = await messagesResponse.json()
  const tools = messages.flatMap((message) => message.parts ?? []).filter((part) => part.type === "tool")
  if (compact) {
    const reads = tools.filter((part) => part.tool === "read")
    assert.equal(reads[0].state.status, "error")
    assert.deepEqual(reads[0].state.input, {})
    assert.match(reads[0].state.error, /INVALID_ARGUMENT.*nonempty filePath/)
    assert.doesNotMatch(reads[0].state.error, /replaceAll|TypeError/)
    assert.equal(reads[1].state.status, "error")
    assert.match(reads[1].state.error, /anchor.*offset/i)
  }
  const diagnostic = JSON.stringify({ index, tools: tools.map((part) => ({ tool: part.tool, status: part.state.status, error: part.state.error, metadata: part.state.metadata })), infos: messages.map((message) => message.info), logs }).slice(-8000)
  assert.ok(tools.some((part) => part.tool === "apply_patch" && part.state.status === "error"), diagnostic)
  assert.ok(tools.some((part) => part.tool === "apply_patch" && part.state.status === "error"), diagnostic)
  assert.ok(tools.some((part) => part.tool === "read" && part.state.status === "completed"), diagnostic)
  assert.ok(tools.some((part) => part.tool === "apply_patch" && part.state.status === "completed"), diagnostic)
  const summary = tools.find((part) => part.tool === "patchline_summary" && part.state.status === "completed")
  if (!compact) {
    assert.ok(summary, diagnostic)
    assert.equal(summary.state.metadata.summary.nativePatchContextMismatches, 1, diagnostic)
  }
  assert.equal(await readFile(path.join(root, "first.txt"), "utf8"), "after\n")
  assert.equal(await readFile(path.join(root, "second.txt"), "utf8"), "after\n")
  if (compact) {
    assert.ok(tools.some((part) => part.tool === "edit" && part.state.status === "completed"), diagnostic)
    assert.equal(await readFile(path.join(root, "exact.txt"), "utf8"), "updated\n")
    assert.ok(tools.some((part) => part.tool === "patchline_edit_batch" && part.state.status === "error"), diagnostic)
    assert.ok(tools.some((part) => part.tool === "patchline_edit_batch" && part.state.status === "completed"), diagnostic)
    const batches = tools.filter((part) => part.tool === "patchline_edit_batch")
    assert.deepEqual(batches.map((part) => part.state.status), ["error", "completed", "error"], diagnostic)
    assert.match(batches[2].state.error, /stale|changed|snapshot/i, diagnostic)
    for (const file of ["batch-a.txt", "batch-b.txt"]) assert.equal(await readFile(path.join(root, file), "utf8"), "updated\n")
  }
  console.log(`Native session smoke passed (${compact ? "compact" : "extended"}): host tool loop, multi-file no-write mismatch, fresh read, recovery${compact ? " and hidden-tool assertions" : " and event counter"} (controlled provider).`)
} finally {
  if (child?.pid && child.exitCode === null) {
    if (process.platform === "win32") await execute("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"]).catch(() => {})
    else child.kill("SIGTERM")
  }
  await new Promise((resolve) => provider.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
