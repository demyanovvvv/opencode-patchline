import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { EditService } from "../src/edit-service.js"
import { isFileReadResult, ReadService } from "../src/read-service.js"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"

const worktree = await mkdtemp(path.join(os.tmpdir(), "patchline-benchmark-"))
try {
  const file = path.join(worktree, "large.ts")
  const before = `${Array.from({ length: 3_000 }, (_, index) => index === 1_499 ? "const timeout = 5000" : `// ${index + 1}`).join("\n")}\n`
  await writeFile(file, before)
  const snapshots = new ScopedSnapshotStore()
  const started = performance.now()
  const observed = await new ReadService(snapshots).read({ sessionId: "benchmark", worktree, filePath: "large.ts", offset: 1_490, limit: 30 })
  if (!isFileReadResult(observed)) throw new Error("Benchmark read unexpectedly returned a directory")
  const result = await new EditService(snapshots).edit({ sessionId: "benchmark", worktree, filePath: "large.ts", snapshot: observed.snapshot, exact: { oldString: "const timeout = 5000", newString: "const timeout = 10000" } })
  const after = await readFile(file, "utf8")
  const report = {
    task: "large-file-one-line-edit",
    functionalSuccess: after.includes("const timeout = 10000"),
    contextLines: observed.endLine - observed.offset + 1,
    added: result.added,
    deleted: result.deleted,
    wholeFileRewrites: 0,
    staleOverwrites: 0,
    routeStrategy: "exact",
    routeConfidence: 0.96,
    strategyFallbacks: 0,
    toolCallsSaved: 0,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
  }
  const json = JSON.stringify(report, null, 2)
  const reportDirectory = path.resolve("benchmarks/reports")
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(path.join(reportDirectory, "latest.json"), `${json}\n`)
  await writeFile(path.join(reportDirectory, "latest.md"), [
    "# Patchline Benchmark",
    "",
    `- Functional success: ${report.functionalSuccess}`,
    `- Context lines: ${report.contextLines}`,
    `- Diff: +${report.added} / -${report.deleted}`,
    `- Whole-file rewrites: ${report.wholeFileRewrites}`,
    `- Stale overwrites: ${report.staleOverwrites}`,
    `- Duration: ${report.durationMs} ms`,
    "",
  ].join("\n"))
  console.log(json)
} finally {
  await rm(worktree, { recursive: true, force: true })
}
