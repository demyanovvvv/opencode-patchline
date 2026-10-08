import { expect, it } from "vitest"
import { readFile } from "node:fs/promises"
it("checks native apply_patch only through the host smoke contract", async () => {
  const source = await readFile(new URL("../scripts/smoke-tools.mjs", import.meta.url), "utf8")
  const { pluginTools, hostTools } = await import(`data:text/javascript,${encodeURIComponent(source)}`) as { pluginTools: string[]; hostTools: string[] }
  expect(pluginTools).not.toContain("apply_patch")
  expect(hostTools).toContain("apply_patch")
  expect(pluginTools).toContain("patchline_apply_patch")
})
