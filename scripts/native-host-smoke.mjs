import { access } from "node:fs/promises"
import { spawn } from "node:child_process"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { nativeHostTestSpec } from "../dist/validation/native-host.js"

const source = process.env.OPENCODE_PATCHLINE_HOST_SOURCE ?? ""
const version = process.env.PATCHLINE_TEST_OPENCODE_VERSION ?? "1.19.0"
const spec = nativeHostTestSpec(source, version)
await access(`${spec.cwd}/test/tool/apply_patch.test.ts`)
const execute = promisify(execFile)
const { stdout } = await execute("git", ["describe", "--tags", "--exact-match", "HEAD"], { cwd: source, timeout: 10_000 })
if (stdout.trim() !== `v${version}`) throw new Error("Native host checkout version does not match requested test version.")
const child = spawn("bun", spec.args, { cwd: spec.cwd, stdio: "inherit", windowsHide: true })
child.once("error", (error) => { console.error(error.message); process.exitCode = 1 })
child.once("close", (code) => { process.exitCode = code ?? 1 })
