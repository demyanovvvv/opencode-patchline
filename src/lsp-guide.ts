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
  const ready = check?.ok === true && !/disabled|unavailable|missing/i.test(check.detail)
  return {
    status: ready ? "ready" : "unavailable",
    summary: ready ? "OpenCode LSP is available." : "OpenCode LSP is unavailable or disabled.",
    steps: [
      "1. Enable LSP in OpenCode by removing lsp: false or adding lsp: {} to opencode.json.",
      "2. Run: opencode-patchline lsp check --directory <project> --json.",
      "3. Run: opencode-patchline lsp setup --directory <project> to prepare managed servers (TypeScript uses typescript-language-server when detected).",
      "4. Restart OpenCode if its version requires configuration to be loaded before startup.",
      "5. Use patchline_lsp for symbols; use ast_search for structure and patchline_grep for literal text when LSP is unavailable.",
    ],
    config: {
      lsp: "auto-detected per project",
      patchline: {
        lspAutoSetup: true,
        lspAutoInstall: true,
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
