import { spawn } from "node:child_process"
import { performance } from "node:perf_hooks"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function fingerprintTree(root: string) {
  const files: { path: string; sha256: string }[] = []
  const walk = async (directory: string) => {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true })
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      const relative = path.posix.join(directory, entry.name)
      if (entry.isDirectory()) await walk(relative)
      else if (entry.isFile()) files.push({ path: relative, sha256: createHash("sha256").update(await readFile(path.join(root, relative))).digest("hex") })
      else throw new Error(`Cannot fingerprint non-regular source: ${relative}`)
    }
  }
  await walk("")
  return { files, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") }
}

export function fixtureGitEnvironment(inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^GIT_/i.test(key))), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "0", GIT_ATTR_NOSYSTEM: "1" }
}

export async function verifyReproducibleBuild(repository: string) {
  const source = await fingerprintTree(path.join(repository, "src"))
  const distribution = await fingerprintTree(path.join(repository, "dist"))
  const scratch = await mkdtemp(path.join(os.tmpdir(), "patchline-build-proof-"))
  try {
    for (const input of ["scripts", "src", "package.json", "tsconfig.json", "tsconfig.build.json"]) {
      await cp(path.join(repository, input), path.join(scratch, input), { recursive: true })
    }
    // Use the installed toolchain, keeping all outputs outside the measured tree.
    await symlink(path.join(repository, "node_modules"), path.join(scratch, "node_modules"), process.platform === "win32" ? "junction" : "dir")
    if ((await fingerprintTree(path.join(scratch, "src"))).sha256 !== source.sha256) throw new Error("Source changed while preparing build verification")
    const build = await runProcess(process.execPath, ["scripts/build.mjs"], { cwd: scratch, env: process.env, timeoutMs: 120000 })
    if (build.code !== 0 || build.outputLimited || build.timedOut) throw new Error(`Reproducibility build failed: ${build.stderr || build.stdout}`)
    const rebuilt = await fingerprintTree(path.join(scratch, "dist"))
    if (rebuilt.sha256 !== distribution.sha256) throw new Error("Measured dist does not match a fresh build of current sources")
    if ((await fingerprintTree(path.join(repository, "src"))).sha256 !== source.sha256
      || (await fingerprintTree(path.join(repository, "dist"))).sha256 !== distribution.sha256) throw new Error("Measured source or distribution changed during build verification")
    return { sourceSha256: source.sha256, distributionSha256: distribution.sha256, rebuiltSha256: rebuilt.sha256 }
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

export async function initializeFixtureRepository(workspace: string) {
  for (const args of [["init", "--quiet", "--template=", "--initial-branch=main"], ["config", "core.autocrlf", "false"], ["config", "core.attributesFile", "/dev/null"], ["add", "--force", "--all"]]) {
    const result = await runProcess("git", args, { cwd: workspace, env: fixtureGitEnvironment(), timeoutMs: 10000 })
    if (result.code !== 0 || result.timedOut || result.spawnError) throw new Error(`Fixture baseline failed: ${result.stderr || result.spawnError || result.code}`)
  }
}

export async function gitIndexFingerprint(workspace: string) {
  // Compare staged paths/modes/object IDs and flags, not Git's refreshable stat cache.
  try { await readFile(path.join(workspace, ".git", "index")) } catch { return null }
  const entries = await runProcess("git", ["ls-files", "--stage", "-z"], { cwd: workspace, env: fixtureGitEnvironment(), timeoutMs: 10000 })
  const flags = await runProcess("git", ["ls-files", "-v", "-z"], { cwd: workspace, env: fixtureGitEnvironment(), timeoutMs: 10000 })
  if (entries.code !== 0 || flags.code !== 0 || entries.outputLimited || flags.outputLimited || entries.timedOut || flags.timedOut) return null
  return createHash("sha256").update(JSON.stringify([entries.stdout, flags.stdout])).digest("hex")
}

export async function runProcess(binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) {
  const started = performance.now()
  const child = spawn(binary, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" })
  let stdout = "", stderr = "", timedOut = false, outputLimited = false
  let spawnError: string | null = null
  let killing = false
  const stop = () => {
    if (killing || !child.pid) return
    killing = true
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      killer.on("error", () => child.kill())
    } else { try { process.kill(-child.pid, "SIGKILL") } catch { child.kill("SIGKILL") } }
  }
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    const remaining = 8_000_000 - stdout.length
    stdout += chunk.slice(0, remaining)
    if (chunk.length > remaining) { outputLimited = true; stop() }
  })
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-64_000) })
  const timer = setTimeout(() => { timedOut = true; stop() }, options.timeoutMs)
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", (error) => { spawnError = error.message; resolve(null) })
    child.once("close", resolve)
  })
  clearTimeout(timer)
  return { code, stdout, stderr, timedOut, outputLimited, spawnError, durationMs: performance.now() - started }
}
