import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { detectLspProjects } from "../src/lsp/projects.js"
import { prepareProjectLsp, type LspEnvironment } from "../src/lsp/manager.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture(files: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-lsp-regression-"))
  roots.push(root)
  for (const file of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), "") }
  return root
}

it("groups markerless source directories within the repository rather than creating a server per folder", async () => {
  const root = await fixture(["src/one/main.py", "src/two/utils.py"])
  const projects = await detectLspProjects(root)
  expect(projects).toHaveLength(1)
  expect(projects[0]?.root).toBe(root)
})

it("detects languages from manifests before the first source file is created", async () => {
  const root = await fixture(["Cargo.toml", "go.mod", "pyproject.toml"])
  expect((await detectLspProjects(root)).map((p) => p.server)).toEqual(expect.arrayContaining(["rust", "gopls", "pyright"]))
})

it("does not use project files as installation scripts", async () => {
  const root = await fixture(["main.ts"])
  let installed = false
  const env: LspEnvironment = {
    async find() { return undefined },
    async npm() { installed = true; return [process.execPath, "/managed/server.js", "--stdio"] },
    async run() { throw new Error("unexpected command") },
  }
  await prepareProjectLsp(root, { environment: env, install: false })
  expect(installed).toBe(false)
})
