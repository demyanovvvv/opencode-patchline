import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveWorkspacePath } from "../src/workspace/paths.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("workspace paths", () => {
  it("resolves nested future paths inside the worktree", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const result = await resolveWorkspacePath(workspace.path, "new/nested/file.ts")
      expect(result.exists).toBe(false)
      expect(result.canonical).toBe(path.join(workspace.path, "new", "nested", "file.ts"))
    } finally {
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
