import { pairedSummary, type PairSample } from "./metrics.js"
import { summarizeLatencies } from "../stats.js"
import { attributionSchedule } from "./config.js"

export function attributionSummary(runs: (Parameters<typeof validateAttributionRuns>[0][number] & { success: boolean })[]) {
  const integrity = validateAttributionRuns(runs)
  const totals = (treatment: string) => {
    const selected = runs.filter((run) => run.treatment === treatment)
    return {
      sessions: selected.length, successful: selected.filter((run) => run.success).length,
      tokens: selected.length && selected.every((run) => run.usage && Number.isFinite(run.usage.total) && run.usage.total > 0) ? selected.reduce((sum, run) => sum + run.usage!.total, 0) : null,
      durationMs: selected.length && selected.every((run) => Number.isFinite(run.durationMs) && run.durationMs > 0) ? selected.reduce((sum, run) => sum + run.durationMs, 0) : null,
    }
  }
  const treatments = { stock: totals("stock"), original: totals("original"), optimized: totals("optimized") }
  const savings = (baseline: typeof treatments.stock) => integrity.complete ? {
    tokenSavings: (baseline.tokens! - treatments.optimized.tokens!) / baseline.tokens!,
    timeSavings: (baseline.durationMs! - treatments.optimized.durationMs!) / baseline.durationMs!,
  } : null
  return { integrity, treatments, optimizedVsOriginal: savings(treatments.original), optimizedVsStock: savings(treatments.stock), acceptance: "not-established-pilot" as const }
}

export function validateAttributionRuns(runs: { taskId: string; repeat: number; treatment: string; durationMs: number; gradingStatus: string; usage: { total: number } | null }[]) {
  const key = (entry: { taskId: string; repeat: number; treatment: string }) => JSON.stringify([entry.taskId, entry.repeat, entry.treatment])
  const expected = new Set(attributionSchedule().map(key))
  const counts = new Map<string, number>()
  for (const run of runs) counts.set(key(run), (counts.get(key(run)) ?? 0) + 1)
  const missing = [...expected].filter((id) => !counts.has(id))
  const unexpected = [...counts.keys()].filter((id) => !expected.has(id))
  const duplicates = [...counts].filter(([, count]) => count !== 1).map(([id]) => id)
  const invalidMeasurements = runs.filter((run) => run.gradingStatus !== "complete" || !Number.isFinite(run.durationMs) || run.durationMs <= 0 || !run.usage || !Number.isFinite(run.usage.total) || run.usage.total <= 0).map(key)
  return { complete: missing.length + unexpected.length + duplicates.length + invalidMeasurements.length === 0, missing, unexpected, duplicates, invalidMeasurements }
}

type SessionIdentity = { taskId: string; repeat: number; mode: string }
export function validateManifest(manifest: SessionIdentity[] | undefined, runs: (SessionIdentity & { durationMs?: number | undefined; gradingStatus?: string; usage?: { total: number } | null })[]) {
  const key = (entry: SessionIdentity) => JSON.stringify([entry.taskId, entry.repeat, entry.mode])
  const validIdentity = (entry: SessionIdentity) => typeof entry.taskId === "string" && entry.taskId.trim().length > 0 && Number.isSafeInteger(entry.repeat) && entry.repeat >= 0 && ["stock", "patchline"].includes(entry.mode)
  const invalidIdentities = [...new Set([...(manifest ?? []), ...runs].filter((entry) => !validIdentity(entry)).map(key))]
  const expected = new Set((manifest ?? []).map(key))
  const pairs = new Map<string, Set<string>>()
  for (const entry of manifest ?? []) {
    const pair = JSON.stringify([entry.taskId, entry.repeat])
    if (!pairs.has(pair)) pairs.set(pair, new Set())
    pairs.get(pair)!.add(entry.mode)
  }
  const unpaired = [...pairs].filter(([, modes]) => !modes.has("stock") || !modes.has("patchline")).map(([pair]) => pair)
  const counts = new Map<string, number>()
  for (const run of runs) counts.set(key(run), (counts.get(key(run)) ?? 0) + 1)
  const missing = [...expected].filter((id) => !counts.has(id))
  const unexpected = [...counts.keys()].filter((id) => !expected.has(id))
  const duplicates = [...counts].filter(([, count]) => count !== 1).map(([id]) => id)
  const ungraded = runs.filter((run) => run.gradingStatus !== "complete").map(key)
  const unmeasured = runs.filter((run) => !run.usage || !Number.isFinite(run.usage.total) || run.usage.total <= 0).map(key)
  const invalidDurations = runs.filter((run) => typeof run.durationMs !== "number" || !Number.isFinite(run.durationMs) || run.durationMs < 0).map(key)
  return { complete: Boolean(manifest?.length) && expected.size === manifest!.length && !unpaired.length && !invalidIdentities.length && !missing.length && !unexpected.length && !duplicates.length && !ungraded.length && !unmeasured.length && !invalidDurations.length, missing, unexpected, duplicates, ungraded, unmeasured, invalidDurations, invalidIdentities, unpaired }
}

export function experimentSummary(samples: PairSample[], projectedSessions?: number) {
  if (projectedSessions !== undefined && (!Number.isSafeInteger(projectedSessions) || projectedSessions <= 0)) throw new Error("Projected session count must be a positive integer")
  for (const sample of samples) {
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) throw new Error("Measured duration must be finite and nonnegative")
    if (sample.tokens !== null && (!Number.isFinite(sample.tokens) || sample.tokens < 0)) throw new Error("Measured tokens must be finite and nonnegative, or null when unavailable")
  }
  const paired = pairedSummary(samples)
  const modeSummary = (mode: "stock" | "patchline") => {
    const runs = samples.filter((sample) => sample.mode === mode)
    if (!runs.length) return null
    const tokens = runs.every((sample) => sample.tokens !== null) ? runs.reduce((sum, sample) => sum + sample.tokens!, 0) : null
    const successes = runs.filter((sample) => sample.success).length
    const times = runs.map((sample) => sample.durationMs).sort((a, b) => a - b)
    return { sessions: runs.length, successes, totalMs: times.reduce((a, b) => a + b, 0), medianMs: (times[Math.floor((times.length - 1) / 2)]! + times[Math.ceil((times.length - 1) / 2)]!) / 2, latency: summarizeLatencies(times), tokens, tokensPerSuccess: tokens !== null && successes ? tokens / successes : null }
  }
  const complete = samples.filter((sample) => sample.mode === "stock").flatMap((stock) => {
    const patchline = samples.find((sample) => sample.mode === "patchline" && sample.taskId === stock.taskId && sample.repeat === stock.repeat)
    return patchline ? [{ stock, patchline }] : []
  })
  const clusters = [...new Set(complete.map((pair) => pair.stock.taskId))].map((id) => complete.filter((pair) => pair.stock.taskId === id))
  const confidence = (key: "durationMs" | "tokens"): [number, number] | null => {
    if (complete.length < 10 || clusters.length < 3 || complete.some((pair) => pair.stock[key] === null || pair.patchline[key] === null)) return null
    let seed = 127_019
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const estimates: number[] = []
    // Resample tasks as clusters to avoid pretending repeats are independent tasks.
    for (let iteration = 0; iteration < 2000; iteration++) {
      let stock = 0, patchline = 0
      for (let draw = 0; draw < clusters.length; draw++) for (const pair of clusters[Math.floor(random() * clusters.length)]!) {
        stock += pair.stock[key]!; patchline += pair.patchline[key]!
      }
      if (stock > 0) estimates.push((stock - patchline) / stock)
    }
    if (!estimates.length) return null
    estimates.sort((a, b) => a - b)
    return [estimates[Math.floor(estimates.length * 0.025)]!, estimates[Math.min(estimates.length - 1, Math.floor(estimates.length * 0.975))]!]
  }
  const both = complete.filter((pair) => pair.stock.success && pair.patchline.success).flatMap((pair) => [pair.stock, pair.patchline])
  const pairedSamples = complete.flatMap((pair) => [pair.stock, pair.patchline])
  const fullProjection = pairedSamples.length && projectedSessions ? { sessions: projectedSessions, estimated: true, tokens: pairedSamples.every((sample) => sample.tokens !== null) ? pairedSamples.reduce((sum, sample) => sum + sample.tokens!, 0) / pairedSamples.length * projectedSessions : null, durationMs: pairedSamples.reduce((sum, sample) => sum + sample.durationMs, 0) / pairedSamples.length * projectedSessions } : null
  return { ...paired, stock: modeSummary("stock"), patchline: modeSummary("patchline"), successfulPairs: pairedSummary(both), timeConfidence95: confidence("durationMs"), tokenConfidence95: confidence("tokens"), confidenceMethod: "2000 task-cluster paired bootstrap samples, seed 127019; unavailable below 10 pairs / 3 tasks", fullProjection }
}
