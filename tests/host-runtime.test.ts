import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { temporaryWorkspace } from "./helpers/workspace.js"
import { findHostBinary, withHostLock } from "../src/installation/host-runtime.js"

it("discovers a cached native binary behind an official npm launcher", async () => {
  const w = await temporaryWorkspace()
  try {
    const bin = path.join(w.path, "node_modules", "opencode-ai", "bin")
    await mkdir(bin, { recursive: true })
    await writeFile(path.join(bin, "opencode"), '#!/usr/bin/env node\nconst cached = path.join(scriptDir, ".opencode")\nconst resolved = envPath || (fs.existsSync(cached) ? cached : findBinary(scriptDir))')
    await writeFile(path.join(bin, ".opencode"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    expect(await findHostBinary(path.join(bin, "opencode"))).toBe(path.join(bin, ".opencode"))
  } finally { await w.cleanup() }
})

it("rejects unknown launchers instead of modifying their source", async () => {
  const w = await temporaryWorkspace()
  try {
    const file = path.join(w.path, "opencode")
    await writeFile(file, "#!/bin/sh\nexec some-other-tool")
    await expect(findHostBinary(file)).rejects.toThrow(/launcher/)
    expect(await readFile(file, "utf8")).toContain("some-other-tool")
  } finally { await w.cleanup() }
})

it("excludes concurrent updates and removes only its own lock", async () => {
  const w = await temporaryWorkspace()
  try {
    const file = path.join(w.path, "host")
    await writeFile(file, "host")
    await withHostLock(file, async () => {
      await expect(withHostLock(file, async () => {})).rejects.toThrow(/already/)
    })
    await expect(withHostLock(file, async () => {})).resolves.toBeUndefined()
  } finally { await w.cleanup() }
})

it.skipIf(process.platform !== "win32")("discovers the official npm launcher through a Windows cmd shim", async () => {
  const w = await temporaryWorkspace()
  try {
    const bin = path.join(w.path, "node_modules", "opencode-ai", "bin")
    await mkdir(bin, { recursive: true })
    const shim = path.join(w.path, "opencode.cmd")
    await writeFile(shim, '@node "%dp0%\\node_modules\\opencode-ai\\bin\\opencode" %*')
    await writeFile(path.join(bin, "opencode"), 'const cached = path.join(scriptDir, ".opencode"); findBinary(scriptDir)')
    await writeFile(path.join(bin, ".opencode"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    expect(await findHostBinary(shim)).toBe(path.join(bin, ".opencode"))
  } finally { await w.cleanup() }
})

it.skipIf(process.platform === "win32")("requires an executable native host on Unix", async () => {
  const w = await temporaryWorkspace()
  try {
    const file = path.join(w.path, "host")
    await writeFile(file, Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    await chmod(file, 0o644)
    await expect(findHostBinary(file)).rejects.toThrow(/executable/)
    await chmod(file, 0o755)
    expect(await findHostBinary(file)).toBe(file)
  } finally { await w.cleanup() }
})
