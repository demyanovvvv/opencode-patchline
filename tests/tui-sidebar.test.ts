import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"

it("registers conversation tool cards without a Patchline sidebar slot", async () => {
  const source = await readFile(new URL("../src/tui.tsx", import.meta.url), "utf8")
  expect(source).toContain("PATCHLINE_ACTIVITY_TOOLS.map")
  expect(source).toContain("api.slots.register")
  expect(source).not.toContain("sidebar_content")
})
