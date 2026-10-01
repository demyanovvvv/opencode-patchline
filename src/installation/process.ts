import { access } from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"

export type CommandResult = { code: number; output: string }

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true } catch { return false }
}

async function launcher(command: string): Promise<{ executable: string; prefix: string[] }> {
  if (process.platform !== "win32" || path.isAbsolute(command)) return { executable: command, prefix: [] }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    if (command === "npm") {
      const cli = path.join(directory, "node_modules", "npm", "bin", "npm-cli.js")
      if (await exists(cli)) return { executable: process.execPath, prefix: [cli] }
    }
    for (const file of [
      path.join(directory, `${command}.exe`),
      ...(command === "opencode" ? [path.join(directory, "node_modules", "opencode-ai", "bin", "opencode.exe")] : []),
    ]) {
      if (await exists(file)) return { executable: file, prefix: [] }
    }
    if (command === "typescript-language-server") {
      const cli = path.join(directory, "node_modules", command, "lib", "cli.mjs")
      if (await exists(cli)) return { executable: process.execPath, prefix: [cli] }
    }
  }
  throw new Error(`Executable unavailable: ${command}`)
}

export async function executeCommand(command: string, args: readonly string[], cwd: string, inherit = false, env: Record<string, string> = {}): Promise<CommandResult> {
  const { executable, prefix } = await launcher(command)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...prefix, ...args], {
      cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    })
    let output = ""
    const append = (chunk: string) => { output = (output + chunk).slice(-20_000) }
    child.stdout?.setEncoding("utf8").on("data", append)
    child.stderr?.setEncoding("utf8").on("data", append)
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Command timed out: ${command}`)) }, inherit ? 900_000 : 30_000)
    child.on("error", (error) => { clearTimeout(timeout); reject(error) })
    child.on("close", (code) => { clearTimeout(timeout); resolve({ code: code ?? 1, output: output.trim() }) })
  })
}