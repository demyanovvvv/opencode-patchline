import { describe, expect, it } from "vitest"
import path from "node:path"
import { collectEvents, compareFiles, pairedSummary, providerUsage } from "../benchmarks/comparison/metrics.js"
import { comparisonTasks } from "../benchmarks/comparison/tasks.js"
import { attributionSchedule, attributionTreatments, isolatedConfig, isolatedEnvironment, parseOptions, profileDiagnosticSchedule, remainingProfileSchedule, validateProfileResumeRuns, profileSettingsFingerprint } from "../benchmarks/comparison/config.js"
import { attributionSummary, experimentSummary, validateAttributionRuns, validateManifest, profileDiagnosticSummary } from "../benchmarks/comparison/analysis.js"

it("vetoes observed quality loss without claiming non-inferiority from no losses", () => {
  const stock = { taskId: "quality", repeat: 0, mode: "stock" as const, durationMs: 100, tokens: 200, success: true }
  const treatment = { ...stock, mode: "patchline" as const, durationMs: 50, tokens: 100, success: false }
  expect(experimentSummary([stock, treatment]).quality).toMatchObject({ status: "veto", regressions: [{ taskId: "quality", repeat: 0 }] })
  expect(experimentSummary([stock, { ...treatment, success: true }]).quality).toMatchObject({ status: "not-established", regressions: [] })
  expect(experimentSummary([]).quality).toMatchObject({ status: "not-established", regressions: [] })
})
import { localChecks, measureToolProfiles } from "../benchmarks/comparison/local.js"

describe("comparison measurement integrity", () => {
  it("pins profile model, execution limits and provider configuration without exposing secrets", () => {
    const settings = { model: "provider/model", steps: 8, timeoutMs: 180000, provider: { apiKey: "private-secret", baseURL: "https://example.test" } }
    const original = profileSettingsFingerprint(settings)
    expect(original).toMatch(/^[a-f0-9]{64}$/)
    for (const change of [{ model: "provider/other" }, { steps: 9 }, { timeoutMs: 190000 }, { provider: { ...settings.provider, apiKey: "changed" } }]) {
      expect(profileSettingsFingerprint({ ...settings, ...change })).not.toBe(original)
    }
    expect(profileSettingsFingerprint(settings)).toBe(original)
  })
  it("rejects corrupt resume outcomes and accepts interrupted dispatches without fabricated results", () => {
    const dispatched = profileDiagnosticSchedule().slice(0, 5)
    const runs = dispatched.slice(0, 4).map((entry) => ({ ...entry, mode: "patchline", gradingStatus: "complete", success: true, measurementArtifact: { file: "attempt-123.json", sha256: "a".repeat(64) } }))
    expect(() => validateProfileResumeRuns(dispatched, runs)).not.toThrow()
    expect(() => validateProfileResumeRuns(dispatched, [{ ...runs[0]!, mode: "stock" }])).toThrow(/results/)
    for (const corrupt of [null, {}, [null], [...runs, runs[0]!], [{ ...runs[0]!, taskId: "unexpected" }], [{ ...runs[0]!, success: undefined }], [{ ...runs[0]!, success: "true" }], [{ ...runs[0]!, measurementArtifact: undefined }], [{ ...runs[0]!, measurementArtifact: " " }], [{ ...runs[0]!, gradingStatus: "pending" }]]) {
      expect(() => validateProfileResumeRuns(dispatched, corrupt)).toThrow(/results/)
    }
  })
  it("counts interrupted profile dispatches as consumed and rejects non-prefix ledgers", () => {
    const schedule = profileDiagnosticSchedule()
    expect(remainingProfileSchedule(schedule.slice(0, 5))).toEqual(schedule.slice(5))
    expect(remainingProfileSchedule(schedule)).toEqual([])
    expect(() => remainingProfileSchedule([schedule[1]!])).toThrow(/prefix/)
    expect(() => remainingProfileSchedule([schedule[0]!, schedule[0]!])).toThrow(/prefix/)
    expect(() => remainingProfileSchedule([...schedule, schedule[0]!])).toThrow(/prefix/)
  })
  it("withholds profile contrasts for duplicate, missing, ungraded or unknown-usage sessions", () => {
    const runs = profileDiagnosticSchedule().map((entry) => ({ ...entry, success: true, gradingStatus: "complete", durationMs: 100, usage: { total: 200 } }))
    expect(profileDiagnosticSummary(runs).integrity.complete).toBe(true)
    expect(profileDiagnosticSummary(runs).compactVsExtended).toEqual({ tokenSavings: 0, timeSavings: 0 })
    for (const invalid of [runs.slice(1), [...runs, runs[0]!], runs.map((r, i) => i ? r : { ...r, gradingStatus: "pending" }), runs.map((r, i) => i ? r : { ...r, usage: { total: null } })]) {
      expect(profileDiagnosticSummary(invalid).integrity.complete).toBe(false)
      expect(profileDiagnosticSummary(invalid).compactVsExtended).toBeNull()
    }
    expect(profileDiagnosticSummary(runs).acceptance).toBe("not-established-diagnostic")
  })
  it("rejects nonfinite profile contrasts even when individual totals are finite", () => {
    const runs = profileDiagnosticSchedule().map((entry) => ({ ...entry, success: true, gradingStatus: "complete", durationMs: entry.toolProfile === "extended" ? Number.MIN_VALUE : 1e300, usage: { total: 200 } }))
    const summary = profileDiagnosticSummary(runs)
    expect(summary.integrity.complete).toBe(false)
    expect(summary.compactVsExtended).toBeNull()
  })
  it("requires explicit bounded authorization for attribution execution", () => {
    expect(() => parseOptions(["run-attribution", "--input", "manifest.json"])).toThrow(/18/)
    const options = parseOptions(["run-attribution", "--input", "manifest.json", "--max-sessions", "18"])
    expect(options.command).toBe("run-attribution")
    expect(options.maxSessions).toBe(18)
    expect(() => parseOptions(["run-attribution", "--input", "manifest.json", "--max-sessions", "19"])).toThrow(/18/)
  })
  it("rejects overflowing attribution aggregates instead of producing NaN savings", () => {
    const runs = attributionSchedule().map((entry) => ({ ...entry, durationMs: Number.MAX_VALUE, gradingStatus: "complete", usage: { total: Number.MAX_VALUE }, success: true }))
    const summary = attributionSummary(runs)
    expect(summary.integrity.complete).toBe(false)
    expect(summary.treatments.stock.tokens).toBeNull()
    expect(summary.treatments.stock.durationMs).toBeNull()
    expect(summary.optimizedVsStock).toBeNull()
  })
  it("withholds attribution savings when a graded session lacks a boolean success result", () => {
    const runs = attributionSchedule().map((entry) => ({ ...entry, durationMs: 10, gradingStatus: "complete", usage: { total: 100 }, success: true }))
    const invalid = runs.map((run, index) => index === 0 ? { ...run, success: "false" } : run)
    expect(attributionSummary(invalid as never).optimizedVsOriginal).toBeNull()
    expect(attributionSummary(invalid as never).integrity.complete).toBe(false)
  })
  it("rejects missing attribution artifact paths with a preflight error", () => {
    expect(() => attributionTreatments({ stockBinary: undefined, integratedBinary: "host", originalPlugin: "old", optimizedPlugin: "new" } as never)).toThrow(/explicit host and plugin paths/)
    expect(() => attributionTreatments({ integratedBinary: "host", originalPlugin: "old", optimizedPlugin: "new" } as never)).toThrow(/explicit host and plugin paths/)
  })
  it("isolates original-versus-stock attribution from optimized costs", () => {
    const runs = attributionSchedule().map((entry) => ({
      ...entry, gradingStatus: "complete", success: true,
      durationMs: entry.treatment === "stock" ? 100 : entry.treatment === "original" ? 75 : 50,
      usage: { total: entry.treatment === "stock" ? 200 : entry.treatment === "original" ? 180 : 100 },
    }))
    const summary = attributionSummary(runs)
    expect(summary.originalVsStock).toEqual({ tokenSavings: 0.1, timeSavings: 0.25 })
    expect(summary.optimizedVsOriginal?.tokenSavings).toBeCloseTo(80 / 180)
    expect(summary.optimizedVsStock).toEqual({ tokenSavings: 0.5, timeSavings: 0.5 })
  })
  it.each(["original-plugin", "optimized-plugin"])("rejects attribution-only --%s in the primary live runner", (option) => {
    expect(() => parseOptions(["run", "--max-sessions", "6", `--${option}`, "plugin.js"])).toThrow(/only.*prepare-attribution/)
  })
  it.each(["model", "steps", "timeout", "max-sessions", "repeats", "variant", "tool-profile", "stage"])("rejects ignored attribution preparation override --%s", (option) => {
    expect(() => parseOptions(["prepare-attribution", `--${option}`, "1"])).toThrow(/fixed design/)
  })
  it("parses attribution preparation without enabling paid execution", () => {
    expect(parseOptions(["prepare-attribution", "--original-plugin", "old/plugin.js", "--optimized-plugin", "new/plugin.js"])).toMatchObject({ command: "prepare-attribution", originalPlugin: "old/plugin.js", optimizedPlugin: "new/plugin.js" })
  })
  it("reports three-treatment totals including failed sessions without claiming acceptance", () => {
    const runs = attributionSchedule().map((entry) => ({ ...entry, durationMs: 10, gradingStatus: "complete", usage: { total: entry.treatment === "optimized" ? 80 : 100 }, success: entry.treatment !== "original" }))
    const summary = attributionSummary(runs)
    expect(summary.integrity.complete).toBe(true)
    expect(summary.treatments.original).toEqual({ sessions: 6, successful: 0, tokens: 600, durationMs: 60 })
    expect(summary.optimizedVsOriginal).toEqual({ tokenSavings: 0.2, timeSavings: 0 })
    expect(summary.originalVsStock).toEqual({ tokenSavings: 0, timeSavings: 0 })
    expect(summary.acceptance).toBe("not-established-pilot")
    expect(attributionSummary(runs.slice(1)).optimizedVsOriginal).toBeNull()
    expect(attributionSummary(runs.slice(1)).originalVsStock).toBeNull()
  })
  it("validates attribution completeness independently from two-mode pairs", () => {
    const runs = attributionSchedule().map((entry) => ({ ...entry, durationMs: 10, gradingStatus: "complete", usage: { total: 100 } }))
    expect(validateAttributionRuns(runs).complete).toBe(true)
    expect(validateAttributionRuns(runs.slice(1)).complete).toBe(false)
    expect(validateAttributionRuns([...runs, runs[0]!]).complete).toBe(false)
    expect(validateAttributionRuns(runs.map((run, index) => index ? run : { ...run, treatment: "patchline" })).complete).toBe(false)
    expect(validateAttributionRuns(runs.map((run, index) => index ? run : { ...run, repeat: 0.5 })).complete).toBe(false)
    expect(validateAttributionRuns(runs.map((run, index) => index ? run : { ...run, usage: null })).complete).toBe(false)
    expect(validateAttributionRuns(runs.map((run, index) => index ? run : { ...run, gradingStatus: "pending" })).complete).toBe(false)
    expect(validateAttributionRuns(runs.map((run, index) => index ? run : { ...run, durationMs: NaN })).complete).toBe(false)
  })
  it("requires explicit distinct attribution plugins and shares the integrated host", () => {
    const input = { stockBinary: "stock.exe", integratedBinary: "integrated.exe", originalPlugin: "original/plugin.js", optimizedPlugin: "optimized/plugin.js" }
    expect(attributionTreatments(input)).toEqual([
      { treatment: "stock", mode: "stock", binary: path.resolve("stock.exe"), plugin: null, toolProfile: null },
      { treatment: "original", mode: "patchline", binary: path.resolve("integrated.exe"), plugin: path.resolve("original/plugin.js"), toolProfile: "extended" },
      { treatment: "optimized", mode: "patchline", binary: path.resolve("integrated.exe"), plugin: path.resolve("optimized/plugin.js"), toolProfile: "compact" },
    ])
    expect(() => attributionTreatments({ ...input, optimizedPlugin: input.originalPlugin })).toThrow(/distinct/)
    expect(() => attributionTreatments({ ...input, originalPlugin: "" })).toThrow(/explicit/)
  })
  it("builds the exact separate three-treatment pilot schedule without conflating model variants", () => {
    const schedule = attributionSchedule()
    expect(schedule).toHaveLength(18)
    expect(schedule.slice(0, 3)).toEqual(["stock", "original", "optimized"].map((treatment) => ({ taskId: "targeted", repeat: 0, treatment })))
    expect(schedule.slice(9, 12)).toEqual(["optimized", "original", "stock"].map((treatment) => ({ taskId: "three-files", repeat: 1, treatment })))
    expect(new Set(schedule.map((entry) => JSON.stringify(entry))).size).toBe(18)
    for (const taskId of ["targeted", "large-file", "three-files"]) {
      for (const treatment of ["stock", "original", "optimized"]) {
        expect(schedule.filter((entry) => entry.taskId === taskId && entry.treatment === treatment)).toHaveLength(2)
      }
    }
  })
  it.each(["stock", "patchline"])("rejects a manifest missing the counterpart of %s", (mode) => {
    const entry = { taskId: "a", repeat: 0, mode }
    expect(validateManifest([entry], [{ ...entry, durationMs: 1, gradingStatus: "complete", usage: { total: 100 } }])).toMatchObject({ complete: false, unpaired: [JSON.stringify(["a", 0])] })
  })
  it.each([
    { taskId: "", repeat: 0, mode: "stock" },
    { taskId: "a", repeat: -1, mode: "stock" },
    { taskId: "a", repeat: 0.5, mode: "stock" },
    { taskId: "a", repeat: 0, mode: "unknown" },
  ])("rejects a self-consistent manifest with invalid identity %j", (entry) => {
    expect(validateManifest([entry], [{ ...entry, durationMs: 1, gradingStatus: "complete", usage: { total: 100 } }]).complete).toBe(false)
  })
  it("compares batch and sequential edits with balanced pairs and identical final bytes", async () => {
    const checks = await localChecks()
    const replay = checks.find((check) => check.name === "batch-edit-replay")!
    expect(replay?.passed).toBe(true)
    const data = replay.data as { finalBytesEqualityVerified: boolean; pairs: { order: string[] }[]; sequential: { toolCalls: number }; batch: { toolCalls: number } }
    expect(data.finalBytesEqualityVerified).toBe(true)
    expect(data.pairs).toHaveLength(20)
    expect(data.pairs.filter((pair) => pair.order[0] === "batch")).toHaveLength(10)
    expect(data.sequential.toolCalls).toBe(2)
    expect(data.batch.toolCalls).toBe(1)
  })
  it("accepts an explicit bounded pilot repeat count", () => {
    expect(parseOptions(["run", "--max-sessions", "12", "--repeats", "2"]).repeats).toBe(2)
    expect(parseOptions(["check"]).repeats).toBe(1)
    expect(() => parseOptions(["run", "--max-sessions", "12", "--repeats", "0"])).toThrow(/repeats/)
  })
  it.each(["1", "2", "3", "4"])("rejects an undersampled full run with %s repeats before launching sessions", (repeats) => {
    expect(() => parseOptions(["run", "--stage", "full", "--max-sessions", "130", "--repeats", repeats])).toThrow(/full.*5|5.*full/i)
  })
  it("measures overlapping tool intervals without double counting wall time", () => {
    const tool = (id: string, start: number, end: number) => ({ type: "tool_use", part: { id, tool: "read", state: { status: "completed", time: { start, end } } } })
    const measured = collectEvents([tool("a", 10, 30), tool("b", 20, 40), tool("c", 50, 55)])
    expect(measured.toolTiming).toEqual({ complete: true, measured: 3, missing: 0, sumMs: 45, activeWallMs: 35, spanMs: 45 })
    const incomplete = collectEvents([tool("a", 30, 10), tool("b", 10, 10)])
    expect(incomplete.toolTiming).toEqual({ complete: false, measured: 1, missing: 1, sumMs: null, activeWallMs: null, spanMs: null })
    expect(incomplete.tools[0]!.durationMs).toBeNull()
    expect(incomplete.tools[1]!.durationMs).toBe(0)
  })
  it("pairs anchor replay pages and balances warm execution order", async () => {
    const checks = await localChecks()
    const replay = checks.find((entry) => entry.name === "anchor-read-replay")!.data as { pageEqualityVerified: boolean; pairs: { order: string[] }[] }
    expect(replay.pageEqualityVerified).toBe(true)
    expect(replay.pairs).toHaveLength(20)
    expect(replay.pairs.filter((pair) => pair.order[0] === "anchor")).toHaveLength(10)
    expect(replay.pairs.filter((pair) => pair.order[0] === "grep-read")).toHaveLength(10)
  })
  it("measures compact schema and policy bytes without treating them as provider tokens", async () => {
    const profiles = await measureToolProfiles(process.cwd())
    expect(profiles.compact.tools).toHaveLength(7)
    expect(profiles.extended.tools.length).toBeGreaterThan(profiles.compact.tools.length)
    expect(profiles.compact.schemaBytes).toBeLessThan(profiles.extended.schemaBytes)
    expect(profiles.compact.policyBytes).toBeLessThan(profiles.extended.policyBytes)
    expect(profiles.compact.tools.map((entry) => entry.name)).not.toContain("patchline_execute")
    expect(profiles.compact.schemaBytes).toBe(profiles.compact.tools.reduce((sum, entry) => sum + entry.schemaBytes, 0))
  })
  it("counts unrelated newline conversion as collateral changes", () => {
    const before = { "a.mjs": "export const x = 1\r\n// preserve\r\n" }
    const expected = { "a.mjs": "export const x = 2\r\n// preserve\r\n" }
    const actual = { "a.mjs": "export const x = 2\n// preserve\n" }
    const result = compareFiles(before, expected, actual)
    expect(result.precision).toBeLessThan(1)
    expect(result.protectedDeletions).toBeGreaterThan(0)
  })
  it("requires every declared session exactly once with complete grading and usage", () => {
    const manifest = [{ taskId: "a", repeat: 0, mode: "stock" as const }, { taskId: "a", repeat: 0, mode: "patchline" as const }]
    const measured = manifest.map((entry) => ({ ...entry, durationMs: 100, gradingStatus: "complete", usage: { total: 100 } }))
    expect(validateManifest(manifest, measured).complete).toBe(true)
    expect(validateManifest(manifest, measured.slice(0, 1)).complete).toBe(false)
    expect(validateManifest(manifest, [...measured, measured[0]!]).complete).toBe(false)
    expect(validateManifest(manifest, [{ ...measured[0]!, gradingStatus: "pending" }, measured[1]!]).complete).toBe(false)
    expect(validateManifest(manifest, [{ ...measured[0]!, usage: null }, measured[1]!]).complete).toBe(false)
    expect(validateManifest(undefined, measured).complete).toBe(false)
  })
  it.each([undefined, NaN, Infinity, -1])("marks sessions with invalid duration %s incomplete", (durationMs) => {
    const entry = { taskId: "a", repeat: 0, mode: "stock" }
    expect(validateManifest([entry], [{ ...entry, durationMs, gradingStatus: "complete", usage: { total: 100 } }])).toMatchObject({ complete: false, invalidDurations: [JSON.stringify(["a", 0, "stock"])] })
  })
  it("counts completed steps once and keeps reasoning and cache disjoint", () => {
    const step = { type: "step_finish", part: { id: "s1", cost: 0, tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 50, write: 5 } } } }
    const result = collectEvents([step, step, { type: "tool_use", part: { id: "t1", tool: "edit", state: { status: "error", error: "rejected" } } }])
    expect(result.usage?.total).toBe(185)
    expect(result.steps).toBe(1)
    expect(result.toolErrors).toBe(1)
    expect(result.tools).toHaveLength(1)
  })

  it("does not turn absent or all-zero usage into free measured tokens", () => {
    expect(collectEvents([]).usage).toBeNull()
    expect(providerUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBeNull()
    expect(providerUsage({ prompt_tokens: -1, completion_tokens: 2 })).toBeNull()
    expect(providerUsage({ prompt_tokens: 100 })).toBeNull()
    expect(providerUsage({ prompt_tokens: 100, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 10 } }))
      .toEqual({ input: 60, output: 20, reasoning: 10, cacheRead: 40, cacheWrite: 0, total: 130 })
  })

  it("penalizes unrelated edits and no-ops without rewarding failure", () => {
    const before = { "a.mjs": "const x = 1\n", "keep.txt": "untouched\n" }
    const expected = { ...before, "a.mjs": "const x = 2\n" }
    expect(compareFiles(before, expected, before)).toMatchObject({ exact: false, precision: null, recall: 0 })
    expect(compareFiles(before, expected, expected)).toMatchObject({ exact: true, precision: 1, recall: 1, unrelatedFiles: [] })
    expect(compareFiles(before, expected, { ...expected, "keep.txt": "oops\n" })).toMatchObject({ exact: false, precision: 0.5, recall: 1, unrelatedFiles: ["keep.txt"] })
    expect(compareFiles(before, expected, { ...expected, "extra.txt": "oops\n" }).precision).toBeLessThan(1)
  })

  it("flags deletion of protected code within an otherwise intended file", () => {
    const before = { a: "// preserve\nconst x = 1\nexport const untouched = true\n" }
    const expected = { a: "// preserve\nconst x = 2\nexport const untouched = true\n" }
    const actual = { a: "const x = 2\nexport const untouched = true\n" }
    expect(compareFiles(before, expected, actual).protectedDeletions).toBe(1)
    expect(compareFiles(before, expected, expected).protectedDeletions).toBe(0)
  })

  it("detects byte-level CRLF damage even when logical changes match", () => {
    const result = compareFiles({ a: "old\r\n" }, { a: "new\r\n" }, { a: "new\n" })
    expect(result.exact).toBe(false)
    expect(result.precision).toBe(0.5)
  })

  it("pairs by task and repeat, includes failed attempts and refuses missing token savings", () => {
    const summary = pairedSummary([
      { taskId: "a", repeat: 0, mode: "stock", durationMs: 100, tokens: 200, success: true },
      { taskId: "a", repeat: 0, mode: "patchline", durationMs: 50, tokens: 100, success: false },
      { taskId: "b", repeat: 0, mode: "stock", durationMs: 100, tokens: null, success: true },
    ])
    expect(summary).toMatchObject({ pairs: 1, bothSuccessful: 0, timeSaving: 0.5, tokenSaving: 0.5 })
    expect(pairedSummary([{ taskId: "a", repeat: 0, mode: "stock", durationMs: 100, tokens: 0, success: true }, { taskId: "a", repeat: 0, mode: "patchline", durationMs: 50, tokens: null, success: true }]).tokenSaving).toBeNull()
  })

  it("keeps pilot uncertainty unavailable and computes full-series paired intervals", () => {
    const pilot = experimentSummary([
      { taskId: "a", repeat: 0, mode: "stock", durationMs: 100, tokens: 200, success: true },
      { taskId: "a", repeat: 0, mode: "patchline", durationMs: 50, tokens: 100, success: true },
    ], 130)
    expect(pilot.timeConfidence95).toBeNull()
    expect(pilot.stock?.medianMs).toBe(100)
    expect(pilot.fullProjection).toMatchObject({ sessions: 130, tokens: 19500, durationMs: 9750, estimated: true })
    expect(experimentSummary([{ taskId: "a", repeat: 0, mode: "stock", durationMs: 100, tokens: 200, success: true }]).fullProjection).toBeNull()
    expect(() => experimentSummary([], 0)).toThrow(/positive integer/)
    const samples = Array.from({ length: 12 }, (_, repeat) => [
      { taskId: `task-${repeat % 3}`, repeat, mode: "stock" as const, durationMs: 100, tokens: 200, success: true },
      { taskId: `task-${repeat % 3}`, repeat, mode: "patchline" as const, durationMs: 50, tokens: 100, success: true },
    ]).flat()
    expect(experimentSummary(samples).timeConfidence95).toEqual([0.5, 0.5])
    expect(experimentSummary(samples).tokenConfidence95).toEqual([0.5, 0.5])
  })
  it.each([NaN, Infinity, -1])("rejects invalid duration %s before statistical analysis", (durationMs) => {
    expect(() => experimentSummary([{ taskId: "a", repeat: 0, mode: "stock", durationMs, tokens: 200, success: true }], 130)).toThrow(/duration/i)
  })
  it.each([NaN, Infinity, -1])("rejects invalid token measurement %s before statistical analysis", (tokens) => {
    expect(() => experimentSummary([{ taskId: "a", repeat: 0, mode: "stock", durationMs: 100, tokens, success: true }], 130)).toThrow(/token/i)
  })
  it.each(["stock", "patchline"] as const)("rejects duplicate %s sessions before pairing or projection", (mode) => {
    const sample = { taskId: "a", repeat: 0, mode, durationMs: 100, tokens: 200, success: true }
    expect(() => experimentSummary([sample, { ...sample, durationMs: 900, success: false }], 130)).toThrow(/Duplicate comparison sample/i)
  })
})

describe("comparison isolation and limits", () => {
  it("discards inherited OpenCode state and restricts config to one provider", () => {
    const environment = isolatedEnvironment("C:/fixture", { OPENCODE_CONFIG: "secret", OPENCODE_CONFIG_CONTENT: "plugins", PATH: "bin" })
    expect(environment.OPENCODE_CONFIG).toBeUndefined()
    expect(environment.PATH).toBe("bin")
    expect(environment.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1")
    const config = isolatedConfig({ model: "test/model", provider: { options: { apiKey: "private" }, models: { model: { name: "model" } } }, mode: "stock", plugin: "plugin.js", steps: 12 })
    expect(config.plugin).toEqual([])
    expect(config.mcp).toEqual({})
    expect(config.enabled_providers).toEqual(["test"])
    expect(config.agent).toMatchObject({ title: { disable: true }, build: { steps: 12 } })
  })

  it("defaults to an offline check and requires explicit bounds for live work", () => {
    expect(parseOptions([]).command).toBe("check")
    expect(() => parseOptions(["run", "--stage", "full"])).toThrow(/max-sessions/)
    expect(() => parseOptions(["run", "--max-sessions", "0"])).toThrow()
    expect(() => parseOptions(["run", "--unknown", "yes"])).toThrow()
    expect(parseOptions(["run", "--stage", "pilot", "--max-sessions", "6"]).maxSessions).toBe(6)
    const full = parseOptions(["run", "--stage", "full", "--max-sessions", "130", "--tool-profile", "compact"])
    expect(full.maxSessions).toBe(130)
    expect(full.toolProfile).toBe("compact")
    expect(() => parseOptions(["run", "--max-sessions", "6", "--tool-profile", "unknown"])).toThrow(/tool-profile/)
    const config = isolatedConfig({ model: "test/model", provider: { models: { model: {} } }, mode: "patchline", plugin: "plugin.js", steps: 12, toolProfile: "compact" })
    expect(config.plugin).toEqual([["plugin.js", expect.objectContaining({ toolProfile: "compact" })]])
  })

  it("ships thirteen independent tasks and a three-task pilot with golden changes", () => {
    expect(comparisonTasks).toHaveLength(13)
    expect(new Set(comparisonTasks.map((task) => task.id)).size).toBe(13)
    expect(comparisonTasks.filter((task) => task.pilot)).toHaveLength(3)
    for (const task of comparisonTasks) {
      expect(task.checks.length).toBeGreaterThan(0)
      expect(compareFiles(task.before, task.expected, task.expected).exact).toBe(true)
      expect(compareFiles(task.before, task.expected, task.before).recall).toBe(0)
    }
  })
})
