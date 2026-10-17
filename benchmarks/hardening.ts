import { performance } from "node:perf_hooks"
import { digestBytes, ScopedSnapshotStore } from "../src/snapshot/store.js"
import { decodeUtf8 } from "../src/preservation/text.js"
import { buildLineIndex } from "../src/preservation/line-index.js"
import { analyzeDiff, diffStats } from "../src/editing/diff.js"
import { diffPreview } from "../src/visualization/diff-preview.js"
import { summarizeLatencies } from "./stats.js"
import { withPathLocks } from "../src/writing/path-lock.js"

const reports = []
for (const spaces of [20_000, 40_000, 80_000]) {
  const samples: number[] = []
  const document = decodeUtf8(Buffer.from("first\n" + " ".repeat(spaces) + "x\n"))
  for (let run = 0; run < 10; run++) {
    const store = new ScopedSnapshotStore()
    const start = performance.now()
    store.record({ sessionId: "benchmark", worktree: process.cwd() }, "adversarial.ts", "adversarial.ts", document, [1])
    samples.push(performance.now() - start)
  }
  reports.push({ spaces, latencyMs: summarizeLatencies(samples), rssBytes: process.memoryUsage().rss })
}
const cancellations: number[] = []
for (let run = 0; run < 10; run++) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const held = withPathLocks(["benchmark-cancellation"], () => gate)
  const controller = new AbortController()
  const pending = withPathLocks(["benchmark-cancellation"], async () => {}, controller.signal)
  const start = performance.now()
  controller.abort()
  try { await pending } catch { cancellations.push(performance.now() - start) }
  release()
  await held
}
console.log(JSON.stringify({ scenario: "hidden-whitespace-tag", reports, peakRssBytes: process.resourceUsage().maxRSS * 1024, queuedCancellationMs: summarizeLatencies(cancellations) }, null, 2))

// Component costs in one process; not CLI startup, disk-cold, or model latency.
const stages = []
for (const lines of [10_000, 100_000]) {
  const target = Math.floor(lines / 2)
  const before = Array.from({ length: lines }, (_, index) => index === target ? "const timeout = 5000" : `// preserved line ${index}`).join("\n") + "\n"
  const after = before.replace("const timeout = 5000", "const timeout = 8000")
  const bytes = Buffer.from(before)
  const statsPairs = []
  for (let run = 0; run < 21; run++) {
    const order = run % 2 === 0 ? ["mapping", "stats"] as const : ["stats", "mapping"] as const
    const measured: Record<string, number> = {}
    for (const kind of order) {
      const start = performance.now()
      const result = kind === "mapping" ? analyzeDiff(before, after, new Set()).stats : diffStats(before, after)
      measured[kind] = performance.now() - start
      if (result.added !== 1 || result.deleted !== 1) throw new Error("Statistics-only diff changed counts")
    }
    statsPairs.push({ run, order, mappingMs: measured.mapping!, statsMs: measured.stats! })
  }
  console.log(JSON.stringify({ scenario: "stats-only-diff-paired-replay", lines, bytes: bytes.length, pairs: statsPairs, warm: { mapping: summarizeLatencies(statsPairs.slice(1).map((pair) => pair.mappingMs)), stats: summarizeLatencies(statsPairs.slice(1).map((pair) => pair.statsMs)) }, scope: "alternating process-local pairs; identical diff budgets; no provider or file IO" }))
  const samples: Record<string, number[]> = {}
  const measure = <T>(name: string, run: () => T): T => {
    const started = performance.now()
    const result = run()
    const values = samples[name] ??= []
    values.push(performance.now() - started)
    return result
  }
  for (let run = 0; run < 10; run++) {
    const document = measure("decode", () => decodeUtf8(bytes))
    const digest = measure("sha256", () => digestBytes(bytes))
    const index = measure("lineIndex", () => buildLineIndex(document.normalizedText))
    const analysis = measure("safetyDiff", () => analyzeDiff(before, after, new Set([target + 1])))
    const preview = measure("displayDiff", () => diffPreview("large.ts", "large.ts", before, after))
    if (document.normalizedText !== before || digest.length !== 64 || index.totalLines !== lines || analysis.stats.added !== 1 || analysis.stats.deleted !== 1 || !analysis.seenLinesAfter.has(target + 1) || preview.truncated || !preview.patch.includes("+const timeout = 8000")) throw new Error("Component profiling invariant failed")
  }
  stages.push({ lines, bytes: bytes.byteLength, stages: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { firstMs: values[0], warm: summarizeLatencies(values.slice(1)), samplesMs: values }])), rssBytes: process.memoryUsage().rss })
}
console.log(JSON.stringify({ scenario: "large-file-component-profile", scope: "sequential process-local first/warm; fixed stage order; no filesystem/model/CLI costs", reports: stages, peakRssBytes: process.resourceUsage().maxRSS * 1024 }, null, 2))

const baselineIndex = (text: string) => {
  const starts = text.length === 0 ? [] : [0]
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) === 10 && at + 1 < text.length) starts.push(at + 1)
  }
  return { starts, totalLines: starts.length, endsWithNewline: text.endsWith("\n") }
}
for (const text of ["", "\n", "\n\n", "a", "a\n", "a\nb", "a\r\nb\r\n", "😀\nx\n"]) {
  if (JSON.stringify(buildLineIndex(text)) !== JSON.stringify(baselineIndex(text))) throw new Error("Optimized line-index edge mismatch")
}
const indexPairs = []
for (const lines of [10_000, 100_000]) {
  const text = Array.from({ length: lines }, (_, index) => `// preserved line ${index}`).join("\n") + "\n"
  const pairs = []
  for (let run = 0; run < 21; run++) {
    const order = run % 2 === 0 ? ["baseline", "optimized"] as const : ["optimized", "baseline"] as const
    const measured: Record<string, number> = {}
    const indexes = []
    for (const name of order) {
      const start = performance.now()
      indexes.push(name === "optimized" ? buildLineIndex(text) : baselineIndex(text))
      measured[name] = performance.now() - start
    }
    if (JSON.stringify(indexes[0]) !== JSON.stringify(indexes[1])) throw new Error("Candidate line-index mismatch")
    pairs.push({ run, order, baselineMs: measured.baseline!, optimizedMs: measured.optimized! })
  }
  indexPairs.push({ lines, first: pairs[0], warm: { baseline: summarizeLatencies(pairs.slice(1).map((pair) => pair.baselineMs)), optimized: summarizeLatencies(pairs.slice(1).map((pair) => pair.optimizedMs)) }, pairs })
}
console.log(JSON.stringify({ scenario: "line-index-optimized-replay", scope: "alternating process-local pairs; original character-loop baseline versus production indexOf; equality gate on complete index", reports: indexPairs }, null, 2))
