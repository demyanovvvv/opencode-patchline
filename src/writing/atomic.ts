import { chmod, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { PatchlineError } from "../errors.js"
import type { FileIdentity } from "../snapshot/store.js"

export async function readFileIdentity(filePath: string): Promise<FileIdentity> {
  const info = await stat(filePath, { bigint: true })
  return { device: info.dev, inode: info.ino }
}

async function assertIdentity(filePath: string, expected: FileIdentity, label: string): Promise<void> {
  const actual = await readFileIdentity(filePath)
  if (actual.device === expected.device && actual.inode === expected.inode) return
  throw new PatchlineError("STALE_SNAPSHOT", `Write rejected: ${label} changed for ${filePath}. Re-read before retrying.`, {
    path: filePath,
    retryable: true,
  })
}

export async function atomicReplace(
  filePath: string,
  bytes: Uint8Array,
  options: { expectedParent: FileIdentity; expectedTarget?: FileIdentity | undefined },
): Promise<FileIdentity> {
  const directory = path.dirname(filePath)
  await assertIdentity(directory, options.expectedParent, "parent directory")
  if (options.expectedTarget) await assertIdentity(filePath, options.expectedTarget, "target")
  const mode = (await stat(filePath)).mode & 0o7777
  const temporaryDirectory = await mkdtemp(path.join(directory, ".patchline-tmp-"))
  const temporaryPath = path.join(temporaryDirectory, path.basename(filePath))
  try {
    await assertIdentity(directory, options.expectedParent, "parent directory")
    if (options.expectedTarget) await assertIdentity(filePath, options.expectedTarget, "target")
    await writeFile(temporaryPath, bytes, { mode })
    await chmod(temporaryPath, mode)
    const replacementIdentity = await readFileIdentity(temporaryPath)
    await assertIdentity(directory, options.expectedParent, "parent directory")
    if (options.expectedTarget) await assertIdentity(filePath, options.expectedTarget, "target")
    await rename(temporaryPath, filePath)
    return replacementIdentity
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
