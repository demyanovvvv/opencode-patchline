import { rm } from "node:fs/promises"
import { spawn } from "node:child_process"

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true })
const command = process.platform === "win32" ? "npx.cmd" : "npx"
const child = spawn(command, ["tsc", "-p", "tsconfig.build.json"], { stdio: "inherit", windowsHide: true, shell: process.platform === "win32" })
child.on("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on("close", (code) => {
  process.exitCode = code ?? 1
})
