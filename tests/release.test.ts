import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execute = promisify(execFile)
const environment = { ...process.env, GITHUB_REF_NAME: undefined }
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string; name: string }

describe("release metadata check", () => {
  it("accepts the package version tag", async () => {
    const tag = `v${packageJson.version}`
    const result = await execute(process.execPath, ["scripts/check-release.mjs", tag], { env: environment })

    expect(result.stdout).toContain(`${packageJson.name}@${packageJson.version} (${tag})`)
  })

  it("rejects a tag that does not match the package version", async () => {
    await expect(execute(process.execPath, ["scripts/check-release.mjs", "v0.0.0"], { env: environment })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`does not match package version ${packageJson.version}`),
    })
  })
})
