import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { PATCHLINE_ACTIVITY_TOOLS } from "../src/visualization/activity.js"
import { PatchlinePlugin } from "../src/plugin.js"

it("registers conversation tool cards without a Patchline sidebar slot", async () => {
  const source = await readFile(new URL("../src/tui.tsx", import.meta.url), "utf8")
  expect(source).toContain("PATCHLINE_ACTIVITY_TOOLS.map")
  expect(source).toContain("api.slots.register")
  expect(source).not.toContain("sidebar_content")
})

it("registers a conversation renderer for every server tool, including LSP status", async () => {
  const server = await PatchlinePlugin({ directory: process.cwd(), worktree: process.cwd() } as never, { lspAutoSetup: false })
  try {
    for (const tool of Object.keys(server.tool!)) expect(PATCHLINE_ACTIVITY_TOOLS as readonly string[]).toContain(tool)
  } finally { await server.dispose!() }
})
