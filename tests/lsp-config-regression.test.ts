import { expect, it } from "vitest"
import { parse } from "jsonc-parser"
import { configureLsp } from "../src/installation/lsp.js"

it("does not add a legacy global TypeScript override for OpenCode-managed LSP", async () => {
  const result = await configureLsp({ cwd: process.cwd(), global: true }, undefined, () => undefined)
  expect(result).toBeUndefined()
})

it("keeps the global configuration valid after removing the legacy override", async () => {
  const source = '{"plugin":["opencode-patchline"],"lsp":{"typescript":{"command":["typescript-language-server","--stdio"]}}}'
  expect(parse(source)).toEqual({ plugin: ["opencode-patchline"], lsp: { typescript: { command: ["typescript-language-server", "--stdio"] } } })
})
