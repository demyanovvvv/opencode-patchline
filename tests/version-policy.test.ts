import { expect, it } from "vitest"
import { installPatchline } from "../src/installer.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

it("rejects prerelease OpenCode before registration", async () => {
  const w = await temporaryWorkspace()
  try {
    let registered = false
    const code = await installPatchline({ cwd: w.path, stdout() {}, stderr() {}, runCommand: async () => { registered = true; return 0 }, captureCommand: async () => ({ code: 0, output: "1.18.34-beta.1" }) })
    expect(code).toBe(1)
    expect(registered).toBe(false)
  } finally { await w.cleanup() }
})
