import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { findExecutable, runLspCommand } from "./process.js"
import type { ServerRecipe } from "./registry.js"

export function lspStorageDirectory(): string {
  const base = process.platform === "win32" ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local") : process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  return path.join(base, "opencode-patchline", "lsp")
}

export async function installNpmServer(recipe: ServerRecipe, storage: string, signal?: AbortSignal): Promise<string[]> {
  if (!recipe.npm) throw new Error(`No npm recipe for ${recipe.id}`)
  const key = createHash("sha256").update(JSON.stringify(recipe.npm)).digest("hex").slice(0, 16)
  const target = path.join(storage, `${recipe.id}-${key}`)
  const entry = path.join(target, "node_modules", recipe.npm.entry)
  async function installed(): Promise<boolean> {
    try { await access(entry); await access(path.join(target, "complete.json")); return true } catch { return false }
  }
  if (await installed()) return [process.execPath, entry, ...recipe.args]
  await mkdir(storage, { recursive: true })
  const lock = `${target}.lock`
  const deadline = Date.now() + 240_000
  while (true) {
    signal?.throwIfAborted()
    try { await mkdir(lock); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (await installed()) return [process.execPath, entry, ...recipe.args]
      if (Date.now() > deadline) throw new Error(`LSP installation lock timed out: ${recipe.id}`)
      // Do not steal a lock from a live installer. Abandoned locks are reported for manual cleanup.
      await delay(100, undefined, signal ? { signal } : {})
    }
  }
  let temporary: string | undefined
  try {
    if (await installed()) return [process.execPath, entry, ...recipe.args]
    const npm = await findExecutable("npm")
    if (!npm) throw new Error("npm is required for managed LSP installation")
    temporary = await mkdtemp(path.join(storage, ".install-"))
    await writeFile(path.join(temporary, "package.json"), JSON.stringify({ private: true }))
    await runLspCommand(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", ...recipe.npm.packages], temporary, signal)
    if (!(await stat(path.join(temporary, "node_modules", recipe.npm.entry))).isFile()) throw new Error(`LSP package entry missing: ${recipe.npm.entry}`)
    const lockfile = await readFile(path.join(temporary, "package-lock.json"), "utf8")
    await writeFile(path.join(temporary, "complete.json"), JSON.stringify({ server: recipe.id, packages: recipe.npm.packages, installedAt: new Date().toISOString(), lockHash: createHash("sha256").update(lockfile).digest("hex") }))
    signal?.throwIfAborted()
    // A target without a completion marker is an incomplete managed installation.
    await rm(target, { recursive: true, force: true })
    await rename(temporary, target)
    temporary = undefined
    return [process.execPath, entry, ...recipe.args]
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
    await rm(lock, { recursive: true, force: true })
  }
}
