import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execute = promisify(execFile)

describe("release metadata check", () => {
  it("accepts the package version tag", async () => {
    const result = await execute(process.execPath, ["scripts/check-release.mjs", "v1.0.0"])

    expect(result.stdout).toContain("opencode-patchline@1.0.0 (v1.0.0)")
  })

  it("rejects a tag that does not match the package version", async () => {
    await expect(execute(process.execPath, ["scripts/check-release.mjs", "v0.0.0"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("does not match package version 1.0.0"),
    })
  })
})
