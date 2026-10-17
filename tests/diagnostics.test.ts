import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runDiagnosticCommand } from "../src/validation/diagnostics.js"

const workspaces: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = path.join(os.tmpdir(), `patchline-diagnostics-${process.pid}-${Date.now()}-${workspaces.length}`)
  await mkdir(directory, { recursive: false })
  workspaces.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

describe("diagnostic commands", () => {
  it("bounds captured output while the command is still running", async () => {
    const workspace = await temporaryDirectory()
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(5_000_000))"`

    const result = await runDiagnosticCommand(command, workspace, 10_000, 30)

    expect(result.ok).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.output.length).toBeLessThanOrEqual(20_000)
    expect(result.output).toContain("diagnostics truncated")
  })

  it("settles promptly when a timed-out command leaves a descendant holding its output pipe", async () => {
    const workspace = await temporaryDirectory()
    const childScript = path.join(workspace, "child.cjs")
    const parentScript = path.join(workspace, "parent.cjs")
    await writeFile(childScript, "setTimeout(() => {}, 30_000)\n")
    await writeFile(parentScript, [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: ['ignore', 'inherit', 'inherit'] })`,
      "setTimeout(() => {}, 30_000)",
    ].join("\n"))
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(parentScript)}`
    const startedAt = Date.now()

    const result = await Promise.race([
      runDiagnosticCommand(command, workspace, 100, 30),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("diagnostics did not settle")), 2_000)),
    ])

    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain("Diagnostics timed out after 100 ms.")
  })

  it("aborts promptly and terminates descendants when the tool context is cancelled", async () => {
    const workspace = await temporaryDirectory()
    const childScript = path.join(workspace, "abort-child.cjs")
    const parentScript = path.join(workspace, "abort-parent.cjs")
    await writeFile(childScript, "setTimeout(() => {}, 30_000)\n")
    await writeFile(parentScript, [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: ['ignore', 'inherit', 'inherit'] })`,
      "setTimeout(() => {}, 30_000)",
    ].join("\n"))
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(parentScript)}`
    const controller = new AbortController()
    const startedAt = Date.now()
    setTimeout(() => controller.abort(), 100)

    await expect(Promise.race([
      runDiagnosticCommand(command, workspace, 30_000, 30, controller.signal),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("diagnostics did not abort")), 2_000)),
    ])).rejects.toMatchObject({ name: "AbortError" })
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })
})
