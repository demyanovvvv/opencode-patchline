import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function temporaryWorkspace(): Promise<{ path: string; cleanup(): Promise<void> }> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-test-")))
  return {
    path: directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}
