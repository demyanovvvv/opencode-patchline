import { execFile } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execute = promisify(execFile)
const environment = { ...process.env, GITHUB_REF_NAME: undefined }
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string; name: string }

describe("release metadata check", () => {
  it("keeps release notes, lockfile and download instructions aligned with the package", async () => {
    const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"))
    expect(lock.version).toBe(packageJson.version)
    expect(lock.packages[""].version).toBe(packageJson.version)
    const notes = await readFile(new URL(`../docs/releases/v${packageJson.version}.md`, import.meta.url), "utf8")
    expect(notes).toContain(`# Patchline ${packageJson.version}`)
    for (const file of ["README.md", "README.ru.md"]) {
      const readme = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
      expect(readme).toContain(`/releases/download/v${packageJson.version}/opencode-patchline-${packageJson.version}.tgz`)
      expect(readme).toContain("SHA256SUMS.txt")
    }
  })
  it("accepts the package version tag", async () => {
    const tag = `v${packageJson.version}`
    const result = await execute(process.execPath, ["scripts/check-release.mjs", tag], { env: environment })

    expect(result.stdout).toContain(`${packageJson.name}@${packageJson.version} (${tag})`)
  })

  it("publishes one package with server and TUI entrypoints", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, unknown> }
    expect(manifest.exports["./tui"]).toMatchObject({ import: "./dist/tui.js", types: "./dist/tui.d.ts" })
    await expect(access(new URL("../src/tui.tsx", import.meta.url))).resolves.toBeUndefined()
  })

  it("isolates smoke configuration and clears inherited OpenCode overrides", async () => {
    const probe = `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import { createSmokeEnvironment } from './scripts/smoke-environment.mjs';
      const root = path.resolve('smoke-home');
      const env = createSmokeEnvironment(root, { PATH: 'launcher', HOME: 'user-home', OPENCODE_CONFIG: 'poison', OPENCODE_CONFIG_CONTENT: 'poison', opencode_server_password: 'poison' });
      assert.equal(env.HOME, root);
      assert.equal(env.USERPROFILE, root);
      assert.equal(env.OPENCODE_TEST_HOME, root);
      assert.equal(env.XDG_CONFIG_HOME, path.join(root, 'config'));
      assert.equal(env.OPENCODE_CONFIG_DIR, path.join(root, 'config', 'opencode'));
      assert.equal(env.OPENCODE_DISABLE_MODELS_FETCH, '1');
      assert.equal(env.OPENCODE_CONFIG, undefined);
      assert.equal(env.OPENCODE_CONFIG_CONTENT, undefined);
      assert.equal(env.opencode_server_password, undefined);
      assert.equal(env.PATH, 'launcher');
    `
    await expect(execute(process.execPath, ["--input-type=module", "-e", probe])).resolves.toMatchObject({ stderr: "" })
  })

  it("rejects a tag that does not match the package version", async () => {
    await expect(execute(process.execPath, ["scripts/check-release.mjs", "v0.0.0"], { env: environment })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`does not match package version ${packageJson.version}`),
    })
  })
})
