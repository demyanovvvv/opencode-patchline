import type { CapabilityCheck } from "./compatibility.js"

export type LspGuide = {
  status: "ready" | "unavailable"
  summary: string
  steps: string[]
  config: Record<string, unknown>
  fallback: string[]
}

export function lspGuide(checks: readonly CapabilityCheck[]): LspGuide {
  const check = checks.find((item) => item.name === "LSP setup")
  const ready = check?.ok === true && /typescript-language-server\s+\S+/i.test(check.detail)
  return {
    status: ready ? "ready" : "unavailable",
    summary: ready ? "OpenCode LSP is available." : "OpenCode LSP is unavailable or disabled.",
    steps: [
      "1. Enable LSP in OpenCode by removing lsp: false or adding lsp: {} to opencode.json.",
      "2. Install the TypeScript server with: npm install --save-dev typescript typescript-language-server.",
      "3. Restart OpenCode and verify with: opencode debug lsp document-symbols <file-uri>.",
      "4. Use patchline_lsp for symbols; use ast_search for structure and patchline_grep for literal text when LSP is unavailable.",
    ],
    config: {
      lsp: {
        typescript: {
          command: ["npx", "typescript-language-server", "--stdio"],
          extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
        },
      },
    },
    fallback: ["ast_search", "patchline_grep"],
  }
}

export function renderLspGuide(guide: LspGuide): string[] {
  return [
    `LSP: ${guide.summary}`,
    ...guide.steps,
    `Fallback tools: ${guide.fallback.join(", ")}`,
    `OpenCode config: ${JSON.stringify(guide.config)}`,
  ]
}
