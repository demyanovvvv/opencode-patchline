import { constants } from "node:fs"
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { createHash } from "node:crypto"
import type { HostRevision } from "./host-runtime.js"
import { atomicReplace, readFileIdentity } from "../writing/atomic.js"
import { decodeUtf8 } from "../preservation/text.js"
import type { FileIdentity } from "../snapshot/store.js"
import { digestBytes } from "../snapshot/store.js"

export type FileSnapshot = { path: string; source: string; identity: FileIdentity; parent: FileIdentity }
export type FileChange = FileSnapshot & { text: string }
export type BinarySnapshot = { path: string; bytes: Uint8Array; identity: FileIdentity; parent: FileIdentity }
export type InstallPaths = { cwd: string; configDirectory?: string; global?: boolean }

export function globalConfigDirectory(): string {
  // OpenCode 1.18 uses xdg-basedir on all platforms, including Windows and macOS.
  return process.env.OPENCODE_CONFIG_DIR ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode")
}

export async function projectDirectory(cwd: string): Promise<string> {
  let directory = path.resolve(cwd)
  while (true) {
    try { await lstat(path.join(directory, ".git")); return directory } catch (error) { if (!missing(error)) throw error }
    const parent = path.dirname(directory)
    if (parent === directory) return path.resolve(cwd)
    directory = parent
  }
}

export function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export async function readSnapshot(file: string): Promise<FileSnapshot | undefined> {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular, non-symlink file: ${file}`)
    if (info.size > 1_048_576) throw new Error(`Configuration exceeds 1 MiB: ${file}`)
    if (path.normalize(await realpath(file)) !== path.normalize(path.resolve(file))) throw new Error(`Symlink configuration path: ${file}`)
    const identity = await readFileIdentity(file)
    const bytes = await readFile(file)
    const document = decodeUtf8(bytes, file)
    return { path: file, source: (document.bom ? "\uFEFF" : "") + document.text, identity, parent: await readFileIdentity(path.dirname(file)) }
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}

export async function assertCurrent(snapshot: FileSnapshot): Promise<void> {
  const current = await readSnapshot(snapshot.path)
  if (!current || current.source !== snapshot.source || current.identity.device !== snapshot.identity.device || current.identity.inode !== snapshot.identity.inode || current.parent.device !== snapshot.parent.device || current.parent.inode !== snapshot.parent.inode) {
    throw new Error(`Configuration changed; retry after inspecting it: ${snapshot.path}`)
  }
}

export async function readBinarySnapshot(file: string): Promise<BinarySnapshot | undefined> {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular, non-symlink file: ${file}`)
    if (path.normalize(await realpath(file)) !== path.normalize(path.resolve(file))) throw new Error(`Symlink binary path: ${file}`)
    return { path: file, bytes: await readFile(file), identity: await readFileIdentity(file), parent: await readFileIdentity(path.dirname(file)) }
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}

export async function assertBinaryCurrent(snapshot: BinarySnapshot): Promise<void> {
  const current = await readBinarySnapshot(snapshot.path)
  if (!current || !Buffer.from(current.bytes).equals(Buffer.from(snapshot.bytes)) || current.identity.device !== snapshot.identity.device || current.identity.inode !== snapshot.identity.inode || current.parent.device !== snapshot.parent.device || current.parent.inode !== snapshot.parent.inode) {
    throw new Error(`Binary host backup changed; retry after inspecting it: ${snapshot.path}`)
  }
}

export async function configurationFiles(options: InstallPaths): Promise<FileSnapshot[]> {
  const directory = options.configDirectory ?? (options.global ? globalConfigDirectory() : options.cwd)
  const directories = new Set([directory])
  if (!options.global) directories.add(path.join(directory, ".opencode"))
  const files: FileSnapshot[] = []
  for (const dir of directories) {
    let ancestor = path.resolve(dir)
    while (true) {
      try {
        const info = await lstat(ancestor)
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe configuration directory: ${ancestor}`)
        if (path.normalize(await realpath(ancestor)) !== path.normalize(path.resolve(ancestor))) throw new Error(`Symlink configuration directory: ${ancestor}`)
        break
      } catch (error) {
        if (!missing(error)) throw error
        const parent = path.dirname(ancestor)
        if (parent === ancestor) throw error
        ancestor = parent
      }
    }
    for (const name of ["opencode.json", "opencode.jsonc", "tui.json", "tui.jsonc"]) {
      const snapshot = await readSnapshot(path.join(dir, name))
      if (snapshot) files.push(snapshot)
    }
  }
  return files
}

export async function backup(snapshot: FileSnapshot): Promise<string> {
  await assertCurrent(snapshot)
  const destination = `${snapshot.path}.patchline-backup-${randomUUID()}`
  await copyFile(snapshot.path, destination, constants.COPYFILE_EXCL)
  await assertCurrent(snapshot)
  return destination
}

export async function commitConfigurations(changes: FileChange[], log: (file: string) => void): Promise<void> {
  for (const change of changes) await assertCurrent(change)
  for (const change of changes) log(await backup(change))
  const committed: FileChange[] = []
  try {
    for (const change of changes) {
      await assertCurrent(change)
      const identity = await atomicReplace(change.path, Buffer.from(change.text), { expectedParent: change.parent, expectedTarget: change.identity, expectedDigest: digestBytes(Buffer.from(change.source)) })
      committed.push({ ...change, source: change.text, text: change.source, identity })
    }
  } catch (error) {
    const conflicts: string[] = []
    for (const change of committed.reverse()) {
      try {
        await assertCurrent(change)
        await atomicReplace(change.path, Buffer.from(change.text), { expectedParent: change.parent, expectedTarget: change.identity, expectedDigest: digestBytes(Buffer.from(change.source)) })
      } catch { conflicts.push(change.path) }
    }
    if (conflicts.length) throw new Error(`Rollback conflicts: ${conflicts.join(", ")}. Backups retained.`, { cause: error })
    throw error
  }
}

export async function saveState(file: string, state: unknown): Promise<void> {
  const text = `${JSON.stringify(state, null, 2)}\n`
  const snapshot = await readSnapshot(file)
  if (snapshot) {
    await assertCurrent(snapshot)
    await atomicReplace(file, Buffer.from(text), { expectedParent: snapshot.parent, expectedTarget: snapshot.identity, expectedDigest: digestBytes(Buffer.from(snapshot.source)) })
  } else {
    await mkdir(path.dirname(file), { recursive: true })
    if (path.normalize(await realpath(path.dirname(file))) !== path.normalize(path.resolve(path.dirname(file)))) throw new Error(`Symlink state directory: ${file}`)
    await writeFile(file, text, { encoding: "utf8", flag: "wx", mode: 0o600 })
  }
}

export async function removeState(file: string): Promise<void> {
  const snapshot = await readSnapshot(file)
  if (snapshot) { await assertCurrent(snapshot); await rm(file) }
}

export async function installHostBinary(source: string, target: string, onRollback?: (restore: () => Promise<void>) => void, expected?: HostRevision): Promise<string> {
  const from = await lstat(source)
  const to = await lstat(target)
  if (!from.isFile() || from.isSymbolicLink() || !to.isFile() || to.isSymbolicLink()) throw new Error("Host binary must be a regular, non-symlink file.")
  const parent = path.dirname(target)
  if (path.normalize(await realpath(parent)) !== path.normalize(path.resolve(parent))) throw new Error("Symlink host directory.")
  const before = await readFile(target)
  const identity = await readFileIdentity(target)
  if (expected && (expected.identity.device !== identity.device || expected.identity.inode !== identity.inode || expected.digest !== createHash("sha256").update(before).digest("hex"))) throw new Error("Host binary changed while building; current host retained.")
  const parentIdentity = await readFileIdentity(parent)
  const temporary = path.join(parent, `.patchline-host-${randomUUID()}`)
  const previous = `${target}.patchline-previous`
  const previousSnapshot = await readBinarySnapshot(previous)
  if ((await readFile(source)).equals(before)) return previous
  const retired = `${temporary}-previous`
  await copyFile(source, temporary, constants.COPYFILE_EXCL)
  const staged = await readBinarySnapshot(temporary)
  let replaced = false
  try {
    const current = await readFileIdentity(target)
    const directory = await readFileIdentity(parent)
    if (current.device !== identity.device || current.inode !== identity.inode || directory.device !== parentIdentity.device || directory.inode !== parentIdentity.inode || !(await readFile(target)).equals(before)) throw new Error("Host binary changed during installation.")
    if (previousSnapshot) { await assertBinaryCurrent(previousSnapshot); await rename(previous, retired) }
    try {
      await rename(target, previous)
      try { await rename(temporary, target); replaced = true }
      catch (error) { await rename(previous, target); throw error }
    } catch (error) {
      if (previousSnapshot) await rename(retired, previous)
      throw error
    }
    const committed = await lstat(target)
    if (!committed.isFile() || committed.isSymbolicLink() || !(await readFile(target)).equals(await readFile(source))) {
      const current = await readBinarySnapshot(target)
      if (staged && current && current.identity.device === staged.identity.device && current.identity.inode === staged.identity.inode && Buffer.from(current.bytes).equals(Buffer.from(staged.bytes))) {
        const backup = await readBinarySnapshot(previous)
        if (!backup || backup.identity.device !== identity.device || backup.identity.inode !== identity.inode || !Buffer.from(backup.bytes).equals(before)) throw new Error("Host rollback backup changed.")
        await atomicReplace(target, before, { expectedParent: parentIdentity, expectedTarget: current.identity })
        if (previousSnapshot) { await rm(previous); await rename(retired, previous) }
        else await rm(previous)
      }
      throw new Error("Committed host binary does not match the source; inspected rollback attempted.")
    }
    const landed = await readBinarySnapshot(target)
    const ownedBackup = await readBinarySnapshot(previous)
    if (!landed || !ownedBackup) throw new Error("Host rollback snapshots unavailable.")
    onRollback?.(async () => {
      await assertBinaryCurrent(landed)
      await assertBinaryCurrent(ownedBackup)
      await atomicReplace(target, ownedBackup.bytes, { expectedParent: landed.parent, expectedTarget: landed.identity })
      if (previousSnapshot) await atomicReplace(previous, previousSnapshot.bytes, { expectedParent: ownedBackup.parent, expectedTarget: ownedBackup.identity })
      else { await assertBinaryCurrent(ownedBackup); await rm(previous) }
    })
    // A running Windows image may lock the retired backup after a verified swap.
    if (previousSnapshot) await rm(retired, { force: true }).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && ["EPERM", "EACCES", "EBUSY"].includes(String(error.code)))) throw error
    })
    return previous
  } catch (error) {
    if (replaced && staged) {
      const current = await readBinarySnapshot(target)
      const ownedBackup = await readBinarySnapshot(previous)
      if (current && ownedBackup && current.identity.device === staged.identity.device && current.identity.inode === staged.identity.inode && Buffer.from(current.bytes).equals(Buffer.from(staged.bytes)) && ownedBackup.identity.device === identity.device && ownedBackup.identity.inode === identity.inode && Buffer.from(ownedBackup.bytes).equals(before)) {
        await atomicReplace(target, before, { expectedParent: parentIdentity, expectedTarget: current.identity })
        if (previousSnapshot) { await rm(previous); await rename(retired, previous) }
        else await rm(previous)
      }
    }
    throw error
  } finally { await rm(temporary, { force: true }) }
}

export async function replaceHostFromSnapshot(source: BinarySnapshot, target: BinarySnapshot, onRollback: (restore: () => Promise<void>) => void): Promise<void> {
  await assertBinaryCurrent(source)
  await assertBinaryCurrent(target)
  const staged = path.join(path.dirname(target.path), `.patchline-restore-${randomUUID()}`)
  const mode = (await lstat(source.path)).mode
  await writeFile(staged, source.bytes, { flag: "wx", mode })
  try {
    await installHostBinary(staged, target.path, onRollback, { identity: target.identity, digest: createHash("sha256").update(target.bytes).digest("hex") })
  } finally { await rm(staged, { force: true }) }
}
