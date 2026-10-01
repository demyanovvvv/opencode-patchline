import path from "node:path"
import type { EditResult } from "../edit-service.js"
import { DIFF_PREVIEW_BUDGET } from "./diff-preview.js"

export function editFiles(results: readonly EditResult[], worktree: string, field: "diff" | "patch") {
  let remaining = DIFF_PREVIEW_BUDGET
  return results.map((item) => {
    const fits = item.diff.length <= remaining
    const preview = fits ? item.diff : ""
    remaining -= preview.length
    return {
      type: item.type ?? "update", path: item.path, relativePath: item.sourcePath ?? item.path, filePath: path.resolve(worktree, item.sourcePath ?? item.path),
      ...(item.sourcePath && item.sourcePath !== item.path ? { movePath: path.resolve(worktree, item.path) } : {}),
      [field]: preview, diffTruncated: item.diffTruncated || !fits,
      additions: item.added, deletions: item.deleted, snapshot: item.snapshot,
    }
  })
}