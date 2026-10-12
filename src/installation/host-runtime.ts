import { constants } from "node:fs"
import { access, lstat, open, readFile, realpath, rm } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { readFileIdentity } from "../writing/atomic.js"
import type { FileIdentity } from "../snapshot/store.js"

export type HostRevision = { identity: FileIdentity; digest: string }
export async function captureHostRevision(file: string): Promise<HostRevision> {
  const handle = await open(file, "r")
  try {
    const info = await handle.stat({ bigint: true })
    const hash = createHash("sha256")
    const chunk = Buffer.alloc(1024 * 1024)
    for (let position = 0; ; ) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (!bytesRead) break
      hash.update(chunk.subarray(0, bytesRead))
      position += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    const identity = await readFileIdentity(file)
    if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size || info.mtimeNs !== after.mtimeNs || info.dev !== identity.device || info.ino !== identity.inode) throw new Error("Host changed during inspection.")
    return { identity, digest: hash.digest("hex") }
  } finally { await handle.close() }
}

export function hostIntegrationStatus(version: string, plugin: string) {
  const [upstream, installed] = version.split("+patchline.")
  if (!installed) return { ok: false, detail: `Stock OpenCode ${upstream}; reinstall integration for full tool cards.` }
  if (installed !== plugin) return { ok: false, detail: `Host Patchline ${installed} differs from package ${plugin}; reinstall integration.` }
  return { ok: true, detail: `OpenCode ${upstream}; Patchline ${plugin}; integrated host matches package.` }
}

async function native(file: string): Promise<boolean> {
  const handle = await open(file, "r")
  try {
    const bytes = Buffer.alloc(4)
    const { bytesRead } = await handle.read(bytes, 0, 4, 0)
    return bytesRead === 4 && (bytes.subarray(0, 2).toString() === "MZ" || bytes.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(bytes.readUInt32BE(0)))
  } finally { await handle.close() }
}

/** Resolve native executables and known official launchers; never overwrite a script. */
export async function findHostBinary(file: string): Promise<string> {
  const resolved = await realpath(file)
  const info = await lstat(resolved)
  if (!info.isFile()) throw new Error("OpenCode host must be a regular file.")
  if (await native(resolved)) {
    if (process.platform !== "win32" && process.env.CI !== "true") {
      try { await access(resolved, constants.X_OK) } catch { throw new Error("OpenCode host is not executable.") }
    }
    return resolved
  }
  if (info.size > 100_000) throw new Error("Unsupported OpenCode launcher.")
  const source = await readFile(resolved, "utf8")
  if (path.basename(resolved).toLowerCase() === "opencode.cmd" && /node_modules[\\/]opencode-ai[\\/]bin[\\/]opencode/.test(source)) {
    return await findHostBinary(path.join(path.dirname(resolved), "node_modules", "opencode-ai", "bin", "opencode"))
  }
  if (!source.includes('path.join(scriptDir, ".opencode")') || !source.includes("findBinary(scriptDir)")) throw new Error("Unsupported OpenCode launcher; select the native binary explicitly.")
  const bin = path.dirname(resolved)
  const cached = path.join(bin, ".opencode")
  try { await access(cached); return await findHostBinary(cached) } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  const platform = process.platform === "win32" ? "windows" : process.platform
  const base = `opencode-${platform}-${process.arch}`
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  // Optional package layouts vary across npm/pnpm/Bun. Only select an unambiguous native package.
  const matches = new Set<string>()
  for (let directory = bin; ; directory = path.dirname(directory)) {
    for (const name of [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]) {
      const candidate = path.join(directory, "node_modules", name, "bin", executable)
      try { matches.add(await findHostBinary(candidate)) } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      }
    }
    if (matches.size || directory === path.dirname(directory)) break
  }
  if (matches.size !== 1) throw new Error("Ambiguous or missing OpenCode native package; select the native binary explicitly.")
  return [...matches][0]!
}

/** Never steal stale locks: an interrupted update requires inspection of its lock. */
export async function withHostLock<T>(binary: string, operation: () => Promise<T>): Promise<T> {
  const parent = path.dirname(binary)
  if (path.normalize(await realpath(parent)) !== path.normalize(path.resolve(parent))) throw new Error("Symlink host directory.")
  const file = `${binary}.patchline-update-lock`
  const token = `${process.pid}:${randomUUID()}\n`
  let handle
  try { handle = await open(file, "wx", 0o600) } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new Error(`OpenCode update already in progress or interrupted. Inspect ${file} before retrying.`)
    throw error
  }
  try {
    await handle.writeFile(token)
    const identity = await handle.stat()
    try { return await operation() } finally {
      const current = await lstat(file)
      if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || await readFile(file, "utf8") !== token) throw new Error("Update lock changed; retained for inspection.")
      await rm(file)
    }
  } finally { await handle.close() }
}
