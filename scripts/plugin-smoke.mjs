import { createServer } from "node:http"
import { access, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const pluginPath = path.resolve(fileURLToPath(new URL("../dist/plugin.js", import.meta.url)))
const worktree = await mkdtemp(path.join(os.tmpdir(), "patchline-plugin-smoke-"))

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!address || typeof address === "string") throw new Error("Could not allocate a local smoke-test port")
  return address.port
}

async function waitForTools(url, child, logs) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenCode exited before plugin load:\n${logs()}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        const toolIds = await response.json()
        if (!Array.isArray(toolIds)) throw new Error("OpenCode returned a non-array tool registry")
        return toolIds
      }
    } catch {
      // The server may still be bootstrapping.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for OpenCode plugin tools:\n${logs()}`)
}

async function resolveOpenCodeCommand() {
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
  throw new Error("OpenCode executable could not be resolved")
}

async function waitForClose(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  const closed = waitForClose(child)
  if (process.platform === "win32" && child.pid !== undefined) {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true })
    await Promise.race([
      new Promise((resolve) => killer.once("close", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
  } else {
    child.kill("SIGTERM")
  }
  await closed
  child.stdout?.destroy()
  child.stderr?.destroy()
  child.unref()
}

async function removeWorktree(directory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      if (!(error instanceof Error) || !["EBUSY", "EPERM"].includes(error.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  await rm(directory, { recursive: true, force: true })
}

const port = await freePort()
const command = await resolveOpenCodeCommand()
const child = spawn(command, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: worktree,
  env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [pluginPath] }) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
})
let output = ""
child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk })
child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk })
const logs = () => output.trim()

try {
  const toolIds = await waitForTools(`http://127.0.0.1:${port}/experimental/tool/ids`, child, logs)
  const required = ["patchline_grep", "ast_search", "patchline_edit_batch", "patchline_diagnostics", "patchline_summary"]
  const missing = required.filter((toolId) => !toolIds.includes(toolId))
  if (missing.length > 0) throw new Error(`OpenCode plugin loaded without required tools: ${missing.join(", ")}`)
  console.log(`OpenCode plugin smoke passed (${required.length} Patchline tools registered)`)
} finally {
  await stopProcess(child)
  await removeWorktree(worktree)
}
