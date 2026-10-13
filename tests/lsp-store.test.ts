import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { installNpmServer } from "../src/lsp/store.js"
import type { ServerRecipe } from "../src/lsp/registry.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it("atomically installs once across concurrent callers and reuses a completed managed package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-lsp-store-"))
  roots.push(root)
  const pkg = path.join(root, "package")
  await mkdir(pkg)
  await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "fixture-lsp", version: "1.0.0", bin: "server.js", scripts: { postinstall: "node -e \"require('fs').writeFileSync('executed','bad')\"" } }))
  await writeFile(path.join(pkg, "server.js"), "console.log('fixture-server')\n")
  const recipe: ServerRecipe = { id: "fixture", language: "fixture", extensions: [".fixture"], markers: [], binary: "fixture", args: [], native: false, npm: { packages: [pkg], entry: "fixture-lsp/server.js" } }
  const storage = path.join(root, "storage")
  const [one, two] = await Promise.all([installNpmServer(recipe, storage), installNpmServer(recipe, storage)])
  expect(one).toEqual(two)
  expect(await readFile(one[1]!, "utf8")).toContain("fixture-server")
  await expect(readFile(path.join(path.dirname(one[1]!), "executed"))).rejects.toMatchObject({ code: "ENOENT" })
  expect(await installNpmServer(recipe, storage)).toEqual(one)
}, 30_000)
