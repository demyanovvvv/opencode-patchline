import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { PatchlineError } from "../src/errors.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

vi.mock("../src/editing/diff.js", async (original) => {
  const diff = await original<typeof import("../src/editing/diff.js")>()
  return { ...diff, diffStats() { throw new PatchlineError("STANDARD_TOOL_REQUIRED", "Diff analysis exceeded its budget.") } }
})
import { PatchlinePlugin } from "../src/plugin.js"

it("returns a no-write adaptive fallback when routing diff exhausts its budget", async () => {
  const workspace = await temporaryWorkspace()
  try {
    const file = path.join(workspace.path, "sample.ts")
    await writeFile(file, "before\n")
    const hooks = await PatchlinePlugin({ directory: workspace.path, worktree: workspace.path } as never)
    const context = { sessionID: "s", messageID: "m", agent: "build", directory: workspace.path, worktree: workspace.path, abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => undefined) }
    const first = await hooks.tool!.read!.execute({ filePath: "sample.ts" }, context) as unknown as { metadata: { snapshot: string } }
    const result = await hooks.tool!.patchline_execute!.execute({ strategy: "auto", operations: [{ filePath: "sample.ts", snapshot: first.metadata.snapshot, oldString: "before", newString: "after" }] }, context)
    expect(result).toMatchObject({ metadata: { status: "fallback_required", strategy: "standard", writes: 0 } })
    expect(context.ask).toHaveBeenCalledTimes(3)
    expect(context.ask).toHaveBeenLastCalledWith(expect.objectContaining({ permission: "edit" }))
    expect(await readFile(file, "utf8")).toBe("before\n")
    await hooks.dispose?.()
  } finally { await workspace.cleanup() }
})
