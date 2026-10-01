import { describe, expect, it } from "vitest"
import { patchlineActivity } from "../src/visualization/activity.js"

describe("Patchline activity presentation", () => {
  it("ignores read-only tools and prioritizes an active mutation", () => {
    expect(patchlineActivity([{ tool: "patchline_lsp", state: { status: "completed" } }])).toBeUndefined()
    const view = patchlineActivity([
      { tool: "edit", input: { filePath: "active.ts" }, state: { status: "running", metadata: { stage: "committing" } } },
      { tool: "edit", input: { filePath: "done.ts" }, state: { status: "completed" } },
      { tool: "patchline_summary", state: { status: "completed" } },
    ])
    expect(view).toMatchObject({ status: "running", label: "Writing changes", paths: ["active.ts"] })
  })

  it("bounds parsed previews to four files and twelve complete rows", () => {
    const files = Array.from({ length: 100 }, (_, index) => ({ path: `${index}.ts`, additions: 100, deletions: 0, patch: `@@ -0,0 +1,100 @@\n${"+line\n".repeat(100)}` }))
    const view = patchlineActivity([{ tool: "apply_patch", state: { status: "completed", metadata: { files, added: 10_000 } } }])
    expect(view?.files).toHaveLength(4)
    expect(view?.files?.[0]?.lines).toHaveLength(12)
    expect(view?.files?.[0]).toHaveProperty("truncated", true)
    expect(view?.additions).toBe(10_000)
    expect(view).toMatchObject({ totalFiles: 100, hiddenFiles: 96 })
  })

  it("shows an active batch stage and path without exposing file content", () => {
    const activity = patchlineActivity([{ tool: "patchline_edit_batch", state: { status: "running", metadata: { stage: "preflight", paths: ["src/a.ts"], total: 1 } } }])
    expect(activity).toMatchObject({ status: "running", label: "Checking snapshots", paths: ["src/a.ts"] })
  })

  it("keeps a rejected batch visibly failed with a recovery action and zero writes", () => {
    const activity = patchlineActivity([{ tool: "patchline_edit_batch", state: { status: "error", error: "INVALID_ARGUMENT: Batch contains duplicate target: src/a.ts", metadata: { status: "failed", stage: "preflight", code: "INVALID_ARGUMENT", reason: "Batch contains duplicate target: src/a.ts", paths: ["src/a.ts"], writes: 0, recoveryAction: "Merge conflicting edits." } } }])
    expect(activity).toMatchObject({ status: "failed", label: "Batch rejected", paths: ["src/a.ts"], writes: 0, recoveryAction: "Merge conflicting edits." })
  })

  it("retains applied changes when validation fails or cannot run", () => {
    for (const status of ["error", "completed"] as const) {
      const view = patchlineActivity([{ tool: "edit", input: { filePath: "changed.ts" }, state: { status, metadata: { stage: "validation", validation: "failed", writes: 1, diff: "@@ -1 +1 @@\n-old\n+new", added: 1, deleted: 1, reason: "validation denied" } } }])
      expect(view).toMatchObject({ status: "failed", label: "Changes applied · validation failed", writes: 1, reason: "validation denied", files: [{ path: "changed.ts", additions: 1, deletions: 1 }] })
    }
  })

  it("distinguishes rollback conflicts from preflight rejection", () => {
    expect(patchlineActivity([{ tool: "patchline_edit_batch", state: { status: "error", metadata: { stage: "rollback", writes: 2, restored: ["a.ts"], conflicts: ["b.ts"] } } }])).toMatchObject({ status: "failed", label: "Batch failed", writes: 2, restored: ["a.ts"], conflicts: ["b.ts"] })
  })

  it("uses structured failure paths before parsing error text", () => {
    const activity = patchlineActivity([{ tool: "patchline_edit_batch", state: { status: "error", error: "opaque", metadata: { paths: ["src/structured.ts"], reason: "opaque" } } }])
    expect(activity?.paths).toEqual(["src/structured.ts"])
  })

  it("presents native edit and apply_patch calls alongside batch edits", () => {
    expect(patchlineActivity([{ tool: "edit", state: { status: "completed", metadata: { diff: "@@ -1 +1 @@\n-old\n+new", added: 1, deleted: 1 } }, input: { filePath: "src/a.ts" } }])?.files?.[0]).toMatchObject({ path: "src/a.ts", additions: 1, deletions: 1 })
    const patch = patchlineActivity([{ tool: "apply_patch", state: { status: "completed", metadata: { files: [{ relativePath: "src/b.ts", patch: "@@ -1 +1 @@\n-old\n+new", additions: 1, deletions: 1 }] } } }])
    expect(patch?.files?.[0]?.path).toBe("src/b.ts")
    expect(patch?.paths).toEqual(["src/b.ts"])
  })

  it("groups additions and deletions from completed unified patches", () => {
    const activity = patchlineActivity([{ tool: "patchline_edit_batch", state: { status: "completed", metadata: { files: [{ path: "src/a.ts", additions: 1, deletions: 1, diff: "@@ -1 +1 @@\n-before\n+after" }] } } }])
    expect(activity?.files).toEqual([{ path: "src/a.ts", additions: 1, deletions: 1, truncated: false, lines: [{ kind: "hunk", text: "@@ -1 +1 @@" }, { kind: "removed", text: "-before" }, { kind: "added", text: "+after" }] }])
  })
})