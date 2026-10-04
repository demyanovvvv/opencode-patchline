import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveWorkspacePath } from "../src/workspace/paths.js"
import { ensureParents } from "../src/writing/parents.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("workspace paths", () => {
  it("creates nested parents through a workspace root alias without escaping it", async () => {
    const workspace = await temporaryWorkspace()
    const aliases = await temporaryWorkspace()
    try {
      const alias = path.join(aliases.path, "root")
      await symlink(workspace.path, alias, process.platform === "win32" ? "junction" : "dir")
      await expect(ensureParents(alias, "nested/deep/file.ts")).resolves.toHaveLength(2)
      expect((await resolveWorkspacePath(workspace.path, "nested/deep")).exists).toBe(true)
      await expect(ensureParents(alias, "../escape/file.ts")).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" })
    } finally {
      await aliases.cleanup()
      await workspace.cleanup()
    }
  })
  it("resolves nested future paths inside the worktree", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const result = await resolveWorkspacePath(workspace.path, "new/nested/file.ts")
      expect(result.exists).toBe(false)
      expect(path.relative(result.workspace, result.canonical)).toBe(path.join("new", "nested", "file.ts"))
    } finally {
      await workspace.cleanup()
    }
  })
  it("uses one canonical absolute spelling for an aliased workspace", async () => {
    const workspace = await temporaryWorkspace()
    const aliases = await temporaryWorkspace()
    try {
      const alias = path.join(aliases.path, "root")
      try { await symlink(workspace.path, alias, process.platform === "win32" ? "junction" : "dir") } catch { return }
      const result = await resolveWorkspacePath(alias, "nested/file.ts")
      expect(path.normalize(result.absolute)).toBe(path.normalize(result.canonical))
    } finally {
      await aliases.cleanup()
      await workspace.cleanup()
    }
  })

  it("rejects parent traversal and .git internals", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(resolveWorkspacePath(workspace.path, "../escape.ts")).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" })
      await expect(resolveWorkspacePath(workspace.path, ".git/config")).rejects.toMatchObject({ code: "GIT_INTERNAL_PATH" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects a symlink escape when supported", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      await writeFile(path.join(outside.path, "secret.ts"), "secret")
      await mkdir(path.join(workspace.path, "links"))
      try {
        await symlink(outside.path, path.join(workspace.path, "links", "outside"), process.platform === "win32" ? "junction" : "dir")
      } catch {
        return
      }
      await expect(resolveWorkspacePath(workspace.path, "links/outside/secret.ts")).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" })
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })

  it("rejects a symlink alias to .git internals", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const git = path.join(workspace.path, ".git")
      const alias = path.join(workspace.path, "metadata")
      await mkdir(git)
      await writeFile(path.join(git, "config"), "internal")
      try {
        await symlink(git, alias, process.platform === "win32" ? "junction" : "dir")
      } catch {
        return
      }
      await expect(resolveWorkspacePath(workspace.path, "metadata/config")).rejects.toMatchObject({ code: "GIT_INTERNAL_PATH" })
    } finally {
      await workspace.cleanup()
    }
  })
})
