import { expect, it } from "vitest"
import { PatchlinePlugin } from "../src/plugin.js"

it("authorizes canonical LSP paths before invoking the CLI", async () => {
  const root = process.cwd()
  const hooks = await PatchlinePlugin({ directory: root, worktree: root } as never)
  const context = { sessionID: "s", messageID: "m", agent: "test", directory: root, worktree: root, abort: new AbortController().signal, metadata() {}, async ask(input: { permission: string; patterns: string[] }) {
    if (input.permission === "read" && input.patterns.some((p) => p.replaceAll("\\", "/") === "src/opencode-version.ts")) throw new Error("canonical LSP denied")
  } }
  await expect(hooks.tool!.patchline_lsp!.execute({ operation: "documentSymbol", filePath: "src/search/../opencode-version.ts" }, context)).rejects.toThrow("canonical LSP denied")
})
