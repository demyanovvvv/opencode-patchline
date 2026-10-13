import assert from "node:assert/strict"
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { resolveInstalledOpenCode, uninstallPatchline } from "../dist/installer.js"
import { installHostBinary } from "../dist/installation/files.js"
import { prepareHostRecovery, recordHostInstall } from "../dist/installation/host-recovery.js"
import { createSmokeEnvironment } from "./smoke-environment.mjs"

const execute = promisify(execFile)
const root = await mkdtemp(path.join(os.tmpdir(), "patchline-host-restoration-smoke-"))
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
try {
  const target = path.join(root, process.platform === "win32" ? "opencode.exe" : "opencode")
  await copyFile(process.argv[2] ?? await resolveInstalledOpenCode(), target)
  const env = createSmokeEnvironment(root)
  const initial = await execute(target, ["--version"], { cwd: root, env, timeout: 30_000 })
  const version = initial.stdout.trim()
  assert.match(version, /^1\.\d+\.\d+$/, "Select a stock OpenCode executable as the first argument; an integrated binary is not an original backup")
  const original = sha(await readFile(target))
  // Real native bytes exercise Windows rename/mode handling without rebuilding a host.
  await prepareHostRecovery(target, version)
  await installHostBinary(process.execPath, target)
  const owner = path.join(root, ".opencode-patchline-state.json")
  await recordHostInstall(target, owner)
  await writeFile(owner, JSON.stringify({ schemaVersion: 1, scope: "project", hostBinary: target }))
  assert.equal(await uninstallPatchline({ cwd: root, restoreHost: true, dryRun: true, stdout() {}, stderr() {} }), 0)
  assert.notEqual(sha(await readFile(target)), original)
  assert.equal(await uninstallPatchline({ cwd: root, restoreHost: true, yes: true, stdout() {}, stderr() {} }), 0)
  assert.equal(sha(await readFile(target)), original)
  assert.equal((await execute(target, ["--version"], { cwd: root, env, timeout: 30_000 })).stdout.trim(), initial.stdout.trim())
  assert.equal(await uninstallPatchline({ cwd: root, hostBinary: target, restoreHost: true, dryRun: true, stdout() {}, stderr() {} }), 0)
  console.log("Host restoration smoke passed: native binary replacement, guarded restore, original hash/version and delayed preview")
} finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
