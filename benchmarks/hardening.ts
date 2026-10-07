import { performance } from "node:perf_hooks"
import { ScopedSnapshotStore } from "../src/snapshot/store.js"
import { decodeUtf8 } from "../src/preservation/text.js"
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
