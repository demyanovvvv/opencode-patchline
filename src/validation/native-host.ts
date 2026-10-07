import path from "node:path"
import { supportsOpenCodeVersion } from "../opencode-version.js"

export function nativeHostTestSpec(source: string, version: string) {
  if (!source.trim()) throw new Error("Specify an existing OpenCode source checkout.")
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Native host tests require a stable OpenCode version.")
  if (!supportsOpenCodeVersion(version)) throw new Error("Native host version is not supported.")
  return { cwd: path.resolve(source, "packages", "opencode"), args: ["test", "test/tool/apply_patch.test.ts", "--timeout", "30000"] }
}
