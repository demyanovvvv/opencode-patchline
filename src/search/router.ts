export type SearchMechanism = "lsp" | "grep" | "ast"

export function routeSearch(query: string): SearchMechanism {
  const normalized = query.toLowerCase()
  if (/\b(empty catch|pattern|structur|syntax|call matching|declaration matching)\b/.test(normalized)) return "ast"
  if (/\b(defin\w*|referenc\w*|implement\w*|symbol\w*|type\w*|caller\w*|call hierarchy|inferred)\b/.test(normalized)) return "lsp"
  return "grep"
}
