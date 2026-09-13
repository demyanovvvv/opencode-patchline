import path from "node:path"

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".lua",
  ".md",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
])

const GENERATED_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
])

const GENERATED_SEGMENTS = new Set(["build", "coverage", "dist", "generated", "node_modules", "vendor"])

export function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function isGeneratedFile(filePath: string, extraPatterns: readonly string[] = []): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase()
  const name = path.basename(normalized)
  if (GENERATED_NAMES.has(name)) return true
  if (normalized.endsWith(".min.js") || normalized.endsWith(".min.css")) return true
  if (normalized.split("/").some((part) => GENERATED_SEGMENTS.has(part))) return true
  return extraPatterns.some((pattern) => normalized.includes(pattern.replaceAll("\\", "/").toLowerCase()))
}

export function matchesAllowedPath(relativePath: string, patterns: readonly string[]): boolean {
  const normalized = relativePath.replaceAll("\\", "/")
  return patterns.some((pattern) => {
    const target = pattern.replaceAll("\\", "/")
    if (!target.includes("*")) return normalized === target
    const expression = target
      .split("*")
      .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
      .join(".*")
    return new RegExp(`^${expression}$`, process.platform === "win32" ? "i" : "").test(normalized)
  })
}

export function looksLikeDirectShellWrite(command: string): boolean {
  return [
    /(?:^|[;&|]\s*)set-content\b/i,
    /\bout-file\b/i,
    /(?:^|[;&|]\s*)tee\b/i,
    /\bsed\s+[^\r\n]*-[a-z]*i[a-z]*\b/i,
    /\bperl\s+[^\r\n]*-[a-z]*pi[a-z]*\b/i,
    /(?:^|[^>])>{1,2}\s*["']?[^\s|&;]+/,
    /\b(?:writeFile|writeFileSync|write_text|write_bytes)\s*\(/,
  ].some((pattern) => pattern.test(command))
}
