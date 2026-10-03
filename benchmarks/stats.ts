export type LatencySummary = {
  count: number
  minMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[Math.max(0, index)]!
}

export function summarizeLatencies(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) throw new Error("Latency samples must contain at least one value.")
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    meanMs: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1]!,
  }
}