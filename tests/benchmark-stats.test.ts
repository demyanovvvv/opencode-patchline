import { describe, expect, it } from "vitest"
import { summarizeLatencies } from "../benchmarks/stats.js"

describe("benchmark latency statistics", () => {
  it("calculates deterministic percentile summaries", () => {
    expect(summarizeLatencies([1, 2, 3, 4, 5])).toEqual({ count: 5, minMs: 1, meanMs: 3, p50Ms: 3, p95Ms: 5, p99Ms: 5, maxMs: 5 })
  })

  it("rejects an empty sample set", () => {
    expect(() => summarizeLatencies([])).toThrow("at least one")
  })
})