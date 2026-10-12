import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("GitHub release distribution", () => {
  it("publishes a verified package and explicit notes without requiring npm publication", async () => {
    const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
    expect(workflow).not.toContain("npm publish")
    expect(workflow).toContain("opencode-ai@1.19.0")
    expect(workflow).toContain("npm run audit:dependencies")
    expect(workflow).toContain("sha256sum")
    expect(workflow).toContain('--notes-file "docs/releases/${GITHUB_REF_NAME}.md"')
    expect(workflow).toContain('"opencode-patchline-${GITHUB_REF_NAME#v}.tgz"')
  })
})
