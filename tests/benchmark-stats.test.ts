import { describe, expect, it } from "vitest"
import { summarizeLatencies } from "../benchmarks/stats.js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

describe("benchmark latency statistics", () => {
  it("reports observed index reuse for every repeated-read sample", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "benchmarks/runner.ts"], { timeout: 20_000 })
    const report = JSON.parse(stdout) as { repeatedRead: { runs: number; lineIndexReused: boolean; samples: Array<{ durationMs: number; lineIndexReused: boolean }> } }
    expect(report.repeatedRead.samples).toHaveLength(report.repeatedRead.runs)
    expect(report.repeatedRead.samples.every((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= 0 && sample.lineIndexReused)).toBe(true)
    expect(report.repeatedRead.lineIndexReused).toBe(report.repeatedRead.samples.every((sample) => sample.lineIndexReused))
  }, 25_000)
  it("calculates deterministic percentile summaries", () => {
    expect(summarizeLatencies([1, 2, 3, 4, 5])).toEqual({ count: 5, minMs: 1, meanMs: 3, p50Ms: 3, p95Ms: 5, p99Ms: 5, maxMs: 5 })
  })

  it("rejects an empty sample set", () => {
    expect(() => summarizeLatencies([])).toThrow("at least one")
  })
})
