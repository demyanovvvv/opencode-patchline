import { execFileSync, spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const mode = process.argv[2] ?? "precision"
const prompt = process.argv.slice(3).join(" ") || "Use patchline_summary exactly once and report its result."
const worktree = await mkdtemp(path.join(os.tmpdir(), "patchline-opencode-blackbox-"))
const plugin = process.env.PATCHLINE_BLACKBOX_PLUGIN ?? path.resolve("dist/plugin.js")

function stop(child) {
  if (child.pid === undefined) return
  spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).unref()
}

try {
  execFileSync("git.exe", ["init", "--initial-branch=main"], { cwd: worktree, windowsHide: true, stdio: "ignore" })
  await writeFile(path.join(worktree, "sample.ts"), "const alpha = 1\nconst beta = 2\n")
  const config = {
    plugin: [[plugin, { mode, telemetry: false, summary: true }]],
    permission: { "*": "allow", read: "allow", grep: "allow", edit: "allow", bash: "allow" },
  }
  const child = spawn("C:/nvm4w/nodejs/node_modules/opencode-ai/bin/opencode.exe", ["run", "--format", "json", "--agent", "build", prompt], {
    cwd: worktree,
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
  const timeout = setTimeout(() => stop(child), 120_000)
  const exitCode = await new Promise((resolve) => child.once("close", resolve))
  clearTimeout(timeout)
  const tools = []
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line)
      if (event.type === "tool_use") tools.push({ tool: event.part.tool, status: event.part.state.status, error: event.part.state.error })
    } catch {
      // Ignore non-JSON diagnostic output.
    }
  }
  console.log(JSON.stringify({ mode, worktree, exitCode, tools, sample: await readFile(path.join(worktree, "sample.ts"), "utf8"), stdout, stderr }, null, 2))
} finally {
  await rm(worktree, { recursive: true, force: true })
}
