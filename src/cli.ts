#!/usr/bin/env node
import { inspectCapabilities } from "./compatibility.js"
import { spawn } from "node:child_process"

async function doctor(): Promise<number> {
  const checks = await inspectCapabilities()
  console.log("Patchline Doctor")
  for (const check of checks) console.log(`${check.ok ? "OK" : "--"} ${check.name}: ${check.detail}`)
  const required = checks.filter((check) => check.name !== "Native LSP tool flag" && check.name !== "Hashline runtime")
  console.log(`Mode: ${required.every((check) => check.ok) ? "PRECISION" : "DEGRADED"}`)
  return required.every((check) => check.ok) ? 0 : 1
}

const command = process.argv[2] ?? "doctor"
if (command === "doctor") {
  process.exitCode = await doctor()
} else if (command === "install") {
  const global = process.argv.includes("--global")
  console.log(`Delegating installation to OpenCode${global ? " global configuration" : " project configuration"}.`)
  const child = spawn("opencode", ["plugin", "opencode-patchline", ...(global ? ["--global"] : [])], {
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  })
  process.exitCode = await new Promise<number>((resolve) => {
    child.on("error", () => resolve(1))
    child.on("close", (code) => resolve(code ?? 1))
  })
} else {
  console.error(`Unknown command: ${command}\nUsage: opencode-patchline <doctor|install> [--global]`)
  process.exitCode = 1
}
