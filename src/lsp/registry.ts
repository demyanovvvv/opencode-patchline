export type ServerRecipe = {
  id: string
  language: string
  extensions: string[]
  markers: string[]
  binary: string
  args: string[]
  native: boolean
  nativeInstall?: boolean
  runtime?: string
  npm?: { packages: string[]; entry: string }
}

function server(id: string, language: string, extensions: string, markers: string, binary: string, args: string[] = [], runtime?: string): ServerRecipe {
  return { id, language, extensions: extensions.split(" "), markers: markers.split(" ").filter(Boolean), binary, args, native: true, ...(runtime ? { runtime } : {}) }
}

// IDs and native recipes are matched against OpenCode v1.19.0, not inferred from package names.
export const LSP_SERVERS: readonly ServerRecipe[] = [
  { ...server("typescript", "TypeScript/JavaScript", ".ts .tsx .js .jsx .mts .cts .mjs .cjs", "tsconfig.json jsconfig.json package.json", "typescript-language-server", ["--stdio"]), npm: { packages: ["typescript@5.9.3", "typescript-language-server@4.3.4"], entry: "typescript-language-server/lib/cli.mjs" } },
  server("deno", "Deno", ".ts .tsx .js .jsx .mjs", "deno.json deno.jsonc", "deno", ["lsp"], "deno"),
  server("vue", "Vue", ".vue", "package.json", "vue-language-server", ["--stdio"]),
  server("svelte", "Svelte", ".svelte", "package.json", "svelteserver", ["--stdio"]),
  server("astro", "Astro", ".astro", "package.json", "astro-ls", ["--stdio"]),
  server("pyright", "Python", ".py .pyi", "pyproject.toml pyrightconfig.json setup.cfg requirements.txt Pipfile", "pyright-langserver", ["--stdio"]),
  server("rust", "Rust", ".rs", "Cargo.toml", "rust-analyzer", [], "cargo"),
  server("gopls", "Go", ".go", "go.mod go.work", "gopls", [], "go"),
  server("clangd", "C/C++", ".c .cpp .cc .cxx .h .hpp .hh .hxx", "compile_commands.json CMakeLists.txt .clangd", "clangd"),
  server("jdtls", "Java", ".java", "pom.xml build.gradle build.gradle.kts .project", "jdtls", [], "java"),
  server("kotlin-ls", "Kotlin", ".kt .kts", "build.gradle.kts build.gradle pom.xml", "kotlin-lsp", [], "java"),
  server("csharp", "C#", ".cs .csx", "global.json", "csharp-ls", [], "dotnet"),
  server("fsharp", "F#", ".fs .fsi .fsx", "global.json", "fsautocomplete", [], "dotnet"),
  server("razor", "Razor", ".razor .cshtml", "global.json", "rzls", [], "dotnet"),
  server("sourcekit-lsp", "Swift", ".swift", "Package.swift", "sourcekit-lsp", [], "swift"),
  server("ruby-lsp", "Ruby", ".rb .rake .gemspec", "Gemfile", "ruby-lsp", [], "ruby"),
  server("php intelephense", "PHP", ".php", "composer.json", "intelephense", ["--stdio"]),
  server("dart", "Dart", ".dart", "pubspec.yaml", "dart", ["language-server", "--protocol=lsp"], "dart"),
  server("elixir-ls", "Elixir", ".ex .exs", "mix.exs", "elixir-ls", [], "elixir"),
  server("zls", "Zig", ".zig .zon", "build.zig", "zls", [], "zig"),
  server("lua-ls", "Lua", ".lua", ".luarc.json .luarc.jsonc", "lua-language-server"),
  server("bash", "Shell", ".sh .bash .zsh .ksh", "", "bash-language-server", ["start"]),
  server("terraform", "Terraform", ".tf .tfvars", ".terraform.lock.hcl", "terraform-ls", ["serve"]),
  server("yaml-ls", "YAML", ".yaml .yml", "", "yaml-language-server", ["--stdio"]),
  { ...server("prisma", "Prisma", ".prisma", "package.json", "prisma", ["language-server"]), nativeInstall: false, npm: { packages: ["@prisma/language-server@6.19.0"], entry: "@prisma/language-server/dist/bin.js" } },
  { ...server("ocaml-lsp", "OCaml", ".ml .mli", "dune-project dune-workspace .merlin", "ocamllsp", [], "opam"), nativeInstall: false },
  server("gleam", "Gleam", ".gleam", "gleam.toml", "gleam", ["lsp"], "gleam"),
  server("clojure-lsp", "Clojure", ".clj .cljs .cljc .edn", "deps.edn project.clj", "clojure-lsp"),
  { ...server("nixd", "Nix", ".nix", "flake.nix", "nixd"), nativeInstall: false },
  server("tinymist", "Typst", ".typ", "typst.toml", "tinymist"),
  server("texlab", "LaTeX", ".tex .bib", ".latexmkrc", "texlab"),
  server("dockerfile", "Dockerfile", ".dockerfile", "", "docker-langserver", ["--stdio"]),
  { ...server("haskell-language-server", "Haskell", ".hs .lhs", "hie.yaml cabal.project stack.yaml", "haskell-language-server-wrapper", ["--lsp"], "ghc"), nativeInstall: false },
  { ...server("julials", "Julia", ".jl", "Project.toml", "julia", ["--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"], "julia"), nativeInstall: false },
  ...([
    ["html", "HTML", ".html .htm", "vscode-html-language-server", "vscode-langservers-extracted", "vscode-langservers-extracted/bin/vscode-html-language-server"],
    ["css", "CSS", ".css .scss .less", "vscode-css-language-server", "vscode-langservers-extracted", "vscode-langservers-extracted/bin/vscode-css-language-server"],
    ["json", "JSON", ".json .jsonc", "vscode-json-language-server", "vscode-langservers-extracted", "vscode-langservers-extracted/bin/vscode-json-language-server"],
    ["markdown", "Markdown", ".md .markdown", "vscode-markdown-language-server", "vscode-langservers-extracted", "vscode-langservers-extracted/bin/vscode-markdown-language-server"],
    ["graphql", "GraphQL", ".graphql .gql", "graphql-lsp", "graphql-language-service-cli", "graphql-language-service-cli/bin/graphql.js"],
  ] as const).map(([id, language, extensions, binary, pkg, entry]) => ({ ...server(id, language, extensions, "", binary, [id === "graphql" ? "server" : "--stdio"]), native: false, npm: { packages: [`${pkg}@${id === "graphql" ? "3.5.0" : "4.10.0"}`], entry } })),
  { ...server("taplo", "TOML", ".toml", "", "taplo", ["lsp", "stdio"]), native: false, npm: { packages: ["@taplo/cli@0.7.0"], entry: "@taplo/cli/dist/cli.js" } },
  { ...server("erlang-ls", "Erlang", ".erl .hrl", "rebar.config", "erlang_ls"), native: false },
  { ...server("r-languageserver", "R", ".r .R", "DESCRIPTION", "R", ["--slave", "-e", "languageserver::run()"], "R"), native: false },
  { ...server("sqls", "SQL", ".sql", "", "sqls"), native: false },
]
