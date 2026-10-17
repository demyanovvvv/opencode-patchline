import { diffLines } from "diff"

export type Usage = { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number }
export type Mode = "stock" | "patchline"
export type Json = Record<string, any>
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0

export function providerUsage(raw: Json | undefined): Usage | null {
  if (!raw || !finite(raw.prompt_tokens) || !finite(raw.completion_tokens)) return null
  const cached = raw.prompt_tokens_details?.cached_tokens ?? 0
  const reasoning = raw.completion_tokens_details?.reasoning_tokens ?? 0
  if (!finite(cached) || !finite(reasoning) || cached > raw.prompt_tokens || reasoning > raw.completion_tokens) return null
  const total = raw.prompt_tokens + raw.completion_tokens
  if (!total) return null
  return { input: raw.prompt_tokens - cached, output: raw.completion_tokens - reasoning, reasoning, cacheRead: cached, cacheWrite: 0, total }
}

export function sumUsage(samples: readonly (Usage | null)[]): Usage | null {
  if (!samples.length || samples.some((sample) => sample === null)) return null
  const sum: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  for (const sample of samples) for (const key of Object.keys(sum) as (keyof Usage)[]) sum[key] += sample![key]
  return sum.total > 0 ? sum : null
}

export function collectEvents(events: readonly Json[]) {
  const steps = new Map<string, Json>()
  const tools = new Map<string, Json>()
  const errors: string[] = []
  let text = ""
  for (const event of events) {
    if (event.type === "step_finish" && typeof event.part?.id === "string") steps.set(event.part.id, event.part)
    if (event.type === "tool_use" && typeof event.part?.id === "string") tools.set(event.part.id, event.part)
    if (event.type === "error") errors.push(JSON.stringify(event.error ?? event))
    if (event.type === "text") text += event.part?.text ?? ""
  }
  const usage = sumUsage([...steps.values()].map((part) => {
    const t = part.tokens
    const values = [t?.input, t?.output, t?.reasoning, t?.cache?.read, t?.cache?.write]
    if (!values.every(finite)) return null
    const [input, output, reasoning, cacheRead, cacheWrite] = values as number[]
    return { input: input!, output: output!, reasoning: reasoning!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, total: values.reduce((a: number, b: number) => a + b, 0) }
  }))
  const intervals: { start: number; end: number }[] = []
  const toolResults = [...tools.values()].map((part) => {
    const start = part.state?.time?.start
    const end = part.state?.time?.end
    const timed = finite(start) && finite(end) && end >= start
    if (timed) intervals.push({ start, end })
    return { name: String(part.tool), status: String(part.state?.status), input: part.state?.input, error: part.state?.error, durationMs: timed ? end - start : null, outputBytes: Buffer.byteLength(String(part.state?.output ?? "")) }
  })
  intervals.sort((left, right) => left.start - right.start)
  let activeWallMs = 0
  let mergedEnd = -Infinity
  for (const interval of intervals) {
    activeWallMs += Math.max(0, interval.end - Math.max(interval.start, mergedEnd))
    mergedEnd = Math.max(mergedEnd, interval.end)
  }
  const complete = intervals.length === toolResults.length
  const toolTiming = {
    complete, measured: intervals.length, missing: toolResults.length - intervals.length,
    sumMs: complete ? intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0) : null,
    activeWallMs: complete ? activeWallMs : null,
    spanMs: complete ? intervals.length ? mergedEnd - intervals[0]!.start : 0 : null,
  }
  return {
    usage, steps: steps.size, text, errors, toolTiming,
    cost: [...steps.values()].every((part) => finite(part.cost)) ? [...steps.values()].reduce((sum, part) => sum + part.cost, 0) : null,
    toolErrors: [...tools.values()].filter((part) => part.state?.status === "error").length,
    tools: toolResults,
  }
}

function changes(file: string, before: string, after: string): Set<string> {
  const result = new Set<string>()
  let oldLine = 1
  let newLine = 1
  const diff = diffLines(before, after, { timeout: 1000 })
  if (!diff) throw new Error("Comparison diff exceeded its budget")
  for (const part of diff) {
    const lines = part.value.split("\n")
    if (lines.at(-1) === "") lines.pop()
    for (const line of lines) {
      if (part.added) result.add(`${file}:+:${newLine}:${line}`)
      else if (part.removed) result.add(`${file}:-:${oldLine}:${line}`)
      if (!part.added) oldLine++
      if (!part.removed) newLine++
    }
  }
  return result
}

export function compareFiles(before: Record<string, string>, expected: Record<string, string>, actual: Record<string, string>) {
  const wanted = new Set<string>()
  const observed = new Set<string>()
  const files = [...new Set([...Object.keys(before), ...Object.keys(expected), ...Object.keys(actual)])].sort()
  const unrelatedFiles: string[] = []
  const diffs: { file: string; added: number; deleted: number; text: string }[] = []
  for (const file of files) {
    for (const key of changes(file, before[file] ?? "", expected[file] ?? "")) wanted.add(key)
    for (const key of changes(file, before[file] ?? "", actual[file] ?? "")) observed.add(key)
    if (before[file] !== actual[file]) {
      if (before[file] === expected[file]) unrelatedFiles.push(file)
      const delta = diffLines(before[file] ?? "", actual[file] ?? "", { timeout: 1000 })
      if (!delta) throw new Error("Report diff exceeded its budget")
      let added = 0, deleted = 0
      const rows: string[] = []
      for (let index = 0; index < delta.length; index++) {
        const part = delta[index]!
        const lines = part.value.split("\n")
        if (lines.at(-1) === "") lines.pop()
        if (part.added) added += lines.length
        if (part.removed) deleted += lines.length
        const visible = part.added || part.removed ? lines : lines.length <= 6 ? lines : [...lines.slice(0, index ? 3 : 0), `… ${lines.length - (index ? 3 : 0) - (index < delta.length - 1 ? 3 : 0)} строк …`, ...lines.slice(index < delta.length - 1 ? -3 : lines.length)]
        rows.push(...visible.map((line) => `${part.added ? "+" : part.removed ? "-" : " "}${line.replace(/\r$/, " ␍")}`))
      }
      diffs.push({ file, added, deleted, text: rows.slice(0, 500).join("\n") })
    }
  }
  const matching = [...observed].filter((key) => wanted.has(key)).length
  const protectedDeletions = [...observed].filter((key) => key.includes(":-:") && !wanted.has(key)).length
  return { exact: files.every((file) => expected[file] === actual[file]), precision: observed.size ? matching / observed.size : null, recall: wanted.size ? matching / wanted.size : null, intendedChanges: wanted.size, actualChanges: observed.size, matchingChanges: matching, protectedDeletions, unrelatedFiles, diffs }
}

export type PairSample = { taskId: string; repeat: number; mode: Mode; durationMs: number; tokens: number | null; success: boolean }
export function pairedSummary(samples: readonly PairSample[]) {
  const pairs = new Map<string, Partial<Record<Mode, PairSample>>>()
  for (const sample of samples) {
    const key = `${sample.taskId}:${sample.repeat}`
    const pair = pairs.get(key) ?? {}
    if (pair[sample.mode]) throw new Error(`Duplicate comparison sample: ${key}:${sample.mode}`)
    pair[sample.mode] = sample
    pairs.set(key, pair)
  }
  const complete = [...pairs.values()].filter((pair): pair is Record<Mode, PairSample> => Boolean(pair.stock && pair.patchline))
  const saving = (key: "durationMs" | "tokens") => {
    if (!complete.length || complete.some((pair) => pair.stock[key] === null || pair.patchline[key] === null)) return null
    const stock = complete.reduce((sum, pair) => sum + pair.stock[key]!, 0)
    const patchline = complete.reduce((sum, pair) => sum + pair.patchline[key]!, 0)
    return stock > 0 ? (stock - patchline) / stock : null
  }
  return { pairs: complete.length, bothSuccessful: complete.filter((pair) => pair.stock.success && pair.patchline.success).length, timeSaving: saving("durationMs"), tokenSaving: saving("tokens") }
}
