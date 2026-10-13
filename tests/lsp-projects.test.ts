import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { detectLspProjects } from "../src/lsp/projects.js"

const roots: string[] = []
async function fixture(files: Record<string, string>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-languages-")))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), content)
  }
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it("discovers distinct language roots without treating dependencies as projects", async () => {
  const root = await fixture({
    "package.json": "{}", "apps/web/package.json": "{}", "apps/web/src/App.vue": "",
    "services/api/go.mod": "module example/api", "services/api/main.go": "",
    "crates/core/Cargo.toml": "[package]", "crates/core/src/lib.rs": "",
    "scripts/pyproject.toml": "[project]", "scripts/main.py": "",
    "infra/main.tf": "", "node_modules/noise/main.java": "", "target/noise.go": "",
  })
  const projects = await detectLspProjects(root)
  expect(projects.map((p) => [path.relative(root, p.root).replaceAll("\\", "/"), p.server])).toEqual(expect.arrayContaining([
    ["apps/web", "vue"], ["services/api", "gopls"], ["crates/core", "rust"], ["scripts", "pyright"], ["infra", "terraform"],
  ]))
  expect(projects.some((p) => p.server === "jdtls")).toBe(false)
  expect(projects.filter((p) => p.server === "gopls")).toHaveLength(1)
})

it("selects Deno for nested Deno files while retaining TypeScript in a Node project", async () => {
  const root = await fixture({ "package.json": "{}", "index.ts": "", "edge/deno.json": "{}", "edge/main.ts": "" })
  const projects = await detectLspProjects(root)
  expect(projects.filter((p) => p.server === "typescript" || p.server === "deno").map((p) => [path.relative(root, p.root), p.server])).toEqual([["", "typescript"], ["edge", "deno"]])
})

it("recognizes non-JS ecosystems, config formats and extensionless scripts", async () => {
  const root = await fixture({
    "main.kt": "", "main.cs": "", "main.fs": "", "main.lua": "", "main.rb": "", "main.php": "", "main.dart": "",
    "main.ex": "", "main.zig": "", "main.ml": "", "main.clj": "", "main.nix": "", "main.typ": "", "main.tex": "",
    "main.hs": "", "main.jl": "", "main.gleam": "", "main.swift": "", "main.cpp": "", "main.java": "",
    "schema.prisma": "", "config.yaml": "", "config.toml": "", "index.html": "", "style.css": "", "Dockerfile": "",
    "bin/run": "#!/usr/bin/env bash\necho test\n",
  })
  const projects = await detectLspProjects(root)
  expect(projects.map((p) => p.server)).toEqual(expect.arrayContaining([
    "kotlin-ls", "csharp", "fsharp", "lua-ls", "ruby-lsp", "php intelephense", "dart", "elixir-ls", "zls", "ocaml-lsp",
    "clojure-lsp", "nixd", "tinymist", "texlab", "haskell-language-server", "julials", "gleam", "sourcekit-lsp", "clangd",
    "jdtls", "prisma", "yaml-ls", "taplo", "html", "css", "dockerfile", "bash",
  ]))
})

it("does not follow directory symlinks outside the workspace and reports a bounded scan", async () => {
  const root = await fixture({ "main.py": "", "other.txt": "" })
  const outside = await fixture({ "main.rs": "" })
  await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
  expect((await detectLspProjects(root)).some((p) => p.server === "rust")).toBe(false)
  await expect(detectLspProjects(root, { maxEntries: 1 })).rejects.toThrow("scan limit")
})
