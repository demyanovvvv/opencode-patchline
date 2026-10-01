import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG, parseConfig } from "../src/config.js"
import { PatchlineError } from "../src/errors.js"
import { WriteService } from "../src/write-service.js"
import { temporaryWorkspace } from "./helpers/workspace.js"

describe("write guard", () => {
  it("rejects an oversized create batch before creating directories", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(new WriteService(DEFAULT_CONFIG).createBatch(Array.from({ length: 501 }, (_, index) => ({
        worktree: workspace.path,
        filePath: `oversized-batch/file-${index}.ts`,
        content: "",
      })))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(readFile(path.join(workspace.path, "oversized-batch", "file-0.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects oversized new-file content before creating directories", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(new WriteService(DEFAULT_CONFIG).write({
        worktree: workspace.path,
        filePath: "oversized/new.ts",
        content: "x".repeat(8 * 1024 * 1024 + 1),
      })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(readFile(path.join(workspace.path, "oversized", "new.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("preflights the aggregate create-batch content budget before creating files", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(new WriteService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "first.ts", content: "a".repeat(4 * 1024 * 1024) },
        { worktree: workspace.path, filePath: "second.ts", content: "b".repeat(4 * 1024 * 1024 + 1) },
      ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(readFile(path.join(workspace.path, "first.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      await expect(readFile(path.join(workspace.path, "second.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("allows new files", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const result = await new WriteService(DEFAULT_CONFIG).write({ worktree: workspace.path, filePath: "new/file.ts", content: "export {}\n" })
      expect(result.created).toBe(true)
      expect(await readFile(path.join(workspace.path, "new/file.ts"), "utf8")).toBe("export {}\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects an existing source file", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "existing.ts")
      await writeFile(file, "original\n")
      await expect(new WriteService(DEFAULT_CONFIG).write({ worktree: workspace.path, filePath: "existing.ts", content: "replacement\n" })).rejects.toMatchObject({ code: "WRITE_PROTECTED" })
      expect(await readFile(file, "utf8")).toBe("original\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("permits an explicit complete-replacement exception", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const file = path.join(workspace.path, "fixture.txt")
      await writeFile(file, "original\n")
      const config = parseConfig({ allowedFullReplacements: ["fixture.txt"] })
      const result = await new WriteService(config).write({ worktree: workspace.path, filePath: "fixture.txt", content: "replacement\n" })
      expect(result.created).toBe(false)
      expect(await readFile(file, "utf8")).toBe("replacement\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("preflights every file before a create batch", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await writeFile(path.join(workspace.path, "exists.ts"), "original\n")
      const service = new WriteService(DEFAULT_CONFIG)
      await expect(service.createBatch([
        { worktree: workspace.path, filePath: "new.ts", content: "new\n" },
        { worktree: workspace.path, filePath: "exists.ts", content: "bad\n" },
      ])).rejects.toMatchObject({ code: "WRITE_PROTECTED" })
      await expect(readFile(path.join(workspace.path, "new.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      expect(await readFile(path.join(workspace.path, "exists.ts"), "utf8")).toBe("original\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects case-insensitive duplicate create targets on Windows", async () => {
    if (process.platform !== "win32") return
    const workspace = await temporaryWorkspace()
    try {
      await expect(new WriteService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "new/File.ts", content: "first\n" },
        { worktree: workspace.path, filePath: "new/file.ts", content: "second\n" },
      ])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" })
      await expect(readFile(path.join(workspace.path, "new", "File.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("protects generated files in create batches", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const service = new WriteService(DEFAULT_CONFIG)
      await expect(service.createBatch([
        { worktree: workspace.path, filePath: "new.ts", content: "new\n" },
        { worktree: workspace.path, filePath: "dist/generated.js", content: "generated\n" },
      ])).rejects.toMatchObject({ code: "GENERATED_FILE" })
      await expect(readFile(path.join(workspace.path, "new.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      await expect(readFile(path.join(workspace.path, "dist/generated.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("protects a new generated path through the single-file write tool", async () => {
    const workspace = await temporaryWorkspace()
    try {
      await expect(new WriteService(DEFAULT_CONFIG).write({
        worktree: workspace.path,
        filePath: "dist/generated.js",
        content: "generated\n",
      })).rejects.toMatchObject({ code: "GENERATED_FILE" })
      await expect(readFile(path.join(workspace.path, "dist/generated.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not delete an external change during create-batch rollback", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const first = path.join(workspace.path, "first.ts")
      class FailingCreateService extends WriteService {
        private writes = 0

        override async writeCreatedFile(item: Parameters<WriteService["writeCreatedFile"]>[0]): Promise<Awaited<ReturnType<WriteService["writeCreatedFile"]>>> {
          this.writes++
          if (this.writes === 2) throw new PatchlineError("TRANSACTION_FAILED", "forced create failure")
          const result = await super.writeCreatedFile(item)
          await writeFile(first, "external\n")
          return result
        }
      }

      await expect(new FailingCreateService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "first.ts", content: "first\n" },
        { worktree: workspace.path, filePath: "second.ts", content: "second\n" },
      ])).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
        writes: 1,
        details: { restored: [], conflicts: ["first.ts"] },
      })
      expect(await readFile(first, "utf8")).toBe("external\n")
      await expect(readFile(path.join(workspace.path, "second.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("removes an unchanged partial creation during create-batch rollback", async () => {
    const workspace = await temporaryWorkspace()
    try {
      class FailingCreateService extends WriteService {
        private writes = 0

        override async writeCreatedFile(item: Parameters<WriteService["writeCreatedFile"]>[0]): Promise<Awaited<ReturnType<WriteService["writeCreatedFile"]>>> {
          this.writes++
          if (this.writes === 2) throw new PatchlineError("TRANSACTION_FAILED", "forced create failure")
          return super.writeCreatedFile(item)
        }
      }

      await expect(new FailingCreateService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "first.ts", content: "first\n" },
        { worktree: workspace.path, filePath: "second.ts", content: "second\n" },
      ])).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
        details: { restored: ["first.ts"], conflicts: [] },
      })
      await expect(readFile(path.join(workspace.path, "first.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      await expect(readFile(path.join(workspace.path, "second.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("rolls back a file created before the create operation returns", async () => {
    const workspace = await temporaryWorkspace()
    try {
      class FailingCreateService extends WriteService {
        override async writeCreatedFile(
          item: Parameters<WriteService["writeCreatedFile"]>[0],
          onCreated?: Parameters<WriteService["writeCreatedFile"]>[1],
        ): Promise<Awaited<ReturnType<WriteService["writeCreatedFile"]>>> {
          const result = await super.writeCreatedFile(item, onCreated)
          throw new PatchlineError("TRANSACTION_FAILED", "forced post-create failure", { cause: result })
        }
      }

      await expect(new FailingCreateService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "partial.ts", content: "partial\n" },
      ])).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
        writes: 1,
        details: { restored: ["partial.ts"], conflicts: [] },
      })
      await expect(readFile(path.join(workspace.path, "partial.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not delete a same-byte replacement during create-batch rollback", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const first = path.join(workspace.path, "first.ts")
      class FailingCreateService extends WriteService {
        private writes = 0

        override async writeCreatedFile(item: Parameters<WriteService["writeCreatedFile"]>[0]): Promise<Awaited<ReturnType<WriteService["writeCreatedFile"]>>> {
          this.writes++
          if (this.writes === 2) throw new PatchlineError("TRANSACTION_FAILED", "forced create failure")
          return super.writeCreatedFile(item)
        }

        override async removeCreatedFile(item: Parameters<WriteService["removeCreatedFile"]>[0]): Promise<void> {
          await rename(first, `${first}.original`)
          await writeFile(first, "first\n")
          return super.removeCreatedFile(item)
        }
      }

      await expect(new FailingCreateService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "first.ts", content: "first\n" },
        { worktree: workspace.path, filePath: "second.ts", content: "second\n" },
      ])).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
        details: { restored: [], conflicts: ["first.ts"] },
      })
      expect(await readFile(first, "utf8")).toBe("first\n")
      expect(await readFile(`${first}.original`, "utf8")).toBe("first\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("does not delete a replacement made before create tracking during rollback", async () => {
    const workspace = await temporaryWorkspace()
    try {
      const first = path.join(workspace.path, "first.ts")
      class FailingCreateService extends WriteService {
        private writes = 0

        override async writeCreatedFile(item: Parameters<WriteService["writeCreatedFile"]>[0]): Promise<Awaited<ReturnType<WriteService["writeCreatedFile"]>>> {
          this.writes++
          if (this.writes === 2) throw new PatchlineError("TRANSACTION_FAILED", "forced create failure")
          const result = await super.writeCreatedFile(item)
          if (this.writes === 1) {
            await rename(first, `${first}.original`)
            await writeFile(first, "first\n")
          }
          return result
        }
      }

      await expect(new FailingCreateService(DEFAULT_CONFIG).createBatch([
        { worktree: workspace.path, filePath: "first.ts", content: "first\n" },
        { worktree: workspace.path, filePath: "second.ts", content: "second\n" },
      ])).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
        details: { restored: [], conflicts: ["first.ts"] },
      })
      expect(await readFile(first, "utf8")).toBe("first\n")
      expect(await readFile(`${first}.original`, "utf8")).toBe("first\n")
    } finally {
      await workspace.cleanup()
    }
  })

  it("rejects an escaped ancestor before creating missing nested directories", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const parent = path.join(workspace.path, "new")
      await mkdir(parent)
      class SwappedParent extends WriteService {
        override async writeCreatedFile(item: Parameters<WriteService["writeCreatedFile"]>[0]) {
          await rename(parent, `${parent}-original`)
          await symlink(outside.path, parent, "junction")
          return super.writeCreatedFile(item)
        }
      }
      await expect(new SwappedParent(DEFAULT_CONFIG).write({ worktree: workspace.path, filePath: "new/deep/file.ts", content: "inside\n" })).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" })
      await expect(new WriteService(DEFAULT_CONFIG).write({ worktree: outside.path, filePath: "deep", content: "marker" })).resolves.toMatchObject({ created: true })
    } finally { await workspace.cleanup(); await outside.cleanup() }
  })

  it("rejects a new target whose parent is swapped to a symlink after preflight", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const parent = path.join(workspace.path, "new")
      const movedParent = path.join(workspace.path, "new-original")
      const outsideParent = path.join(outside.path, "new")
      await writeFile(path.join(outside.path, "marker"), "outside\n")
      await mkdir(outsideParent)
      const service = new (class extends WriteService {
        override async writeCreatedFile(item: Parameters<WriteService["writeCreatedFile"]>[0]): Promise<Awaited<ReturnType<WriteService["writeCreatedFile"]>>> {
          await rename(parent, movedParent)
          try {
            await symlink(outsideParent, parent, "junction")
          } catch {
            await rename(movedParent, parent)
            throw new PatchlineError("CAPABILITY_UNAVAILABLE", "Directory junction creation is unavailable")
          }
          return super.writeCreatedFile(item)
        }
      })(DEFAULT_CONFIG)
      await mkdir(parent)

      await expect(service.write({ worktree: workspace.path, filePath: "new/file.ts", content: "inside\n" })).rejects.toMatchObject({
        code: "SYMLINK_ESCAPE",
      })
      await expect(readFile(path.join(outsideParent, "file.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })

  it("rejects a create-batch target whose parent is swapped to a symlink", async () => {
    const workspace = await temporaryWorkspace()
    const outside = await temporaryWorkspace()
    try {
      const parent = path.join(workspace.path, "new")
      const movedParent = path.join(workspace.path, "new-original")
      const outsideParent = path.join(outside.path, "new")
      await mkdir(parent)
      await mkdir(outsideParent)
      const service = new (class extends WriteService {
        override async writeCreatedFile(item: Parameters<WriteService["writeCreatedFile"]>[0]): Promise<Awaited<ReturnType<WriteService["writeCreatedFile"]>>> {
          await rename(parent, movedParent)
          try {
            await symlink(outsideParent, parent, "junction")
          } catch {
            await rename(movedParent, parent)
            throw new PatchlineError("CAPABILITY_UNAVAILABLE", "Directory junction creation is unavailable")
          }
          return super.writeCreatedFile(item)
        }
      })(DEFAULT_CONFIG)

      await expect(service.createBatch([
        { worktree: workspace.path, filePath: "new/file.ts", content: "inside\n" },
      ])).rejects.toMatchObject({ code: "TRANSACTION_FAILED", writes: 0 })
      await expect(readFile(path.join(outsideParent, "file.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await workspace.cleanup()
      await outside.cleanup()
    }
  })
})
