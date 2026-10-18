import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { Script } from "node:vm"
import { describe, expect, it } from "vitest"
import { createRelay, StreamUsage, StreamToolCalls } from "../benchmarks/comparison/relay.js"
import { evaluateTask, materialize, prepareTaskWorkspace, recordMeasuredRun, saveMeasurementArtifact } from "../benchmarks/comparison/evaluate.js"
import { comparisonTasks } from "../benchmarks/comparison/tasks.js"
import { profileDiagnosticSchedule, parseOptions, reserveProfileDispatch, loadProfileDispatches, verifyProfileIdentity, verifyProfileMeasurementArtifacts, profileSettingsFingerprint } from "../benchmarks/comparison/config.js"
import { markdownReport, renderReport } from "../benchmarks/comparison/report.js"
import { fingerprintTree, fixtureGitEnvironment, gitIndexFingerprint, initializeFixtureRepository, runProcess, verifyReproducibleBuild } from "../benchmarks/comparison/process.js"
import { dispatchAttributionSchedule, fingerprintAttributionArtifacts, saveAttributionManifest, verifyAttributionManifest, reserveAttributionDispatch, loadAttributionDispatches, validateAttributionResumeRuns } from "../benchmarks/comparison/config.js"

describe("comparison runtime", () => {
  it("shows quality veto in Markdown and HTML despite positive savings", () => {
    const report = { stage: "full", model: "fixture", integrity: { complete: true }, notes: [], runs: [
      { taskId: "quality", title: "Quality", repeat: 0, mode: "stock", success: true, durationMs: 100, usage: { total: 200 } },
      { taskId: "quality", title: "Quality", repeat: 0, mode: "patchline", success: false, durationMs: 50, usage: { total: 100 } },
    ] }
    expect(markdownReport(report)).toContain("QUALITY VETO: quality#0")
    expect(renderReport(report)).toContain("QUALITY VETO: quality#0")
    expect(markdownReport({ ...report, runs: [] })).toContain("Качество: отсутствие регрессии не доказано.")
    const html = renderReport({ ...report, runs: report.runs.map((run) => ({ ...run, taskId: "</script><img src=x onerror=alert(1)>" })) })
    expect(html).not.toContain("</script><img")
    expect(html).toContain("\\u003c/script>")
    expect(html).toContain("document.getElementById('quality').textContent=D.qualityNotice")
    expect(renderReport({ ...report, runs: [] })).toContain("Качество: отсутствие регрессии не доказано.")
  })
  it("binds attribution settings to the parsed provider configuration", async () => {
    const runner = await readFile(new URL("../benchmarks/comparison/runner.ts", import.meta.url), "utf8")
    expect(runner).toContain("report.environment.settingsFingerprint = profileSettingsFingerprint({ model, steps: options.steps, timeoutMs: options.timeoutMs, provider })")
  })
  it("rejects attribution resume with changed or missing execution settings", () => {
    const settings = { model: "provider/model", steps: 8, timeoutMs: 180000, provider: { baseURL: "https://example.test/v1" } }
    const fingerprint = profileSettingsFingerprint(settings)
    for (const changed of [{ ...settings, model: "provider/other" }, { ...settings, steps: 9 }, { ...settings, timeoutMs: 1 }, { ...settings, provider: { baseURL: "https://other.test/v1" } }]) {
      expect(() => validateAttributionResumeRuns([], 0, [], { saved: fingerprint, current: profileSettingsFingerprint(changed) })).toThrow(/settings/i)
    }
    expect(() => validateAttributionResumeRuns([], 0, [], { saved: undefined, current: fingerprint })).toThrow(/settings/i)
    expect(() => validateAttributionResumeRuns([], 0, [], { saved: fingerprint, current: fingerprint })).not.toThrow()
  })
  it("resumes past an interrupted attribution slot while preserving measured evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patchline-attribution-resume-"))
    try {
      const schedule = ["stock", "original", "optimized"].map((treatment) => ({ taskId: "targeted", repeat: 0, treatment, mode: treatment === "stock" ? "stock" : "patchline" }))
      await reserveAttributionDispatch(root, schedule, 0)
      const measurement = { ...schedule[0]!, errors: [], usage: { total: 123 }, durationMs: 456 }
      const measurementArtifact = await saveMeasurementArtifact(root, measurement)
      const run = { ...measurement, measurementArtifact, gradingStatus: "complete", success: true }
      await reserveAttributionDispatch(root, schedule, 1)
      const consumed = await loadAttributionDispatches(root, schedule)
      validateAttributionResumeRuns(schedule, consumed, [run])
      await verifyProfileMeasurementArtifacts(root, [run])
      expect(consumed).toBe(2)
      await reserveAttributionDispatch(root, schedule, consumed)
      expect(await loadAttributionDispatches(root, schedule)).toBe(3)
      await verifyProfileMeasurementArtifacts(root, [run])
      expect(run.usage.total).toBe(123)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("accepts actual completed attribution grading and rejects undispatched or duplicate results", () => {
    const entry = { taskId: "targeted", repeat: 0, treatment: "stock", mode: "stock" }
    const run = { ...entry, gradingStatus: "complete", success: true }
    expect(() => validateAttributionResumeRuns([entry], 1, [run])).not.toThrow()
    for (const runs of [[run, run], [{ ...run, gradingStatus: "completed" }], [{ ...run, treatment: "optimized" }], [null]]) expect(() => validateAttributionResumeRuns([entry], 1, runs)).toThrow()
    expect(() => validateAttributionResumeRuns([entry], 0, [run])).toThrow()
  })
  it("reports token evaluation without monetary pricing commentary", () => {
    const report = { stage: "offline-check", model: "offline", runs: [], notes: [] }
    expect(markdownReport(report)).not.toMatch(/Стоимость|тариф/i)
    expect(markdownReport(report)).toContain("Экономия токенов")
    expect(markdownReport(report)).toContain("Точность эталонного diff")
    expect(renderReport(report)).not.toMatch(/Стоимость|тариф|бесплатн/i)
  })
  it("allows only one concurrent reservation of an attribution slot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patchline-attribution-race-"))
    try {
      const schedule = [{ taskId: "targeted", repeat: 0, treatment: "stock", mode: "stock" }]
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => reserveAttributionDispatch(root, schedule, 0)))
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1)
      expect(await loadAttributionDispatches(root, schedule)).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("durably reserves attribution slots without retrying interrupted dispatches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patchline-attribution-ledger-"))
    try {
      const schedule = [{ taskId: "targeted", repeat: 0, mode: "stock", treatment: "stock" }, { taskId: "targeted", repeat: 0, mode: "patchline", treatment: "original" }]
      await expect(reserveAttributionDispatch(root, schedule, 1)).rejects.toThrow(/order/)
      await reserveAttributionDispatch(root, schedule, 0)
      expect(await loadAttributionDispatches(root, schedule)).toBe(1)
      await expect(reserveAttributionDispatch(root, schedule, 0)).rejects.toThrow()
      await expect(loadAttributionDispatches(root, [{ ...schedule[0]!, treatment: "optimized" }, schedule[1]!])).rejects.toThrow(/identity/)
      await reserveAttributionDispatch(root, schedule, 1)
      expect(await loadAttributionDispatches(root, schedule)).toBe(2)
      await rm(path.join(root, "attribution-dispatch-01.json"))
      await expect(loadAttributionDispatches(root, schedule)).rejects.toThrow(/gap/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("verifies resumed raw measurement bytes and dispatch identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patchline-resume-artifact-"))
    try {
      const entry = profileDiagnosticSchedule()[0]!
      const measurementArtifact = await saveMeasurementArtifact(root, { ...entry, errors: ["Session timeout"] })
      const run = { ...entry, errors: ["Session timeout"], measurementArtifact }
      await expect(verifyProfileMeasurementArtifacts(root, [run])).resolves.toBeUndefined()
      await expect(verifyProfileMeasurementArtifacts(root, [{ ...run, errors: [...run.errors, "Evaluation failed"] }])).resolves.toBeUndefined()
      await expect(verifyProfileMeasurementArtifacts(root, [{ ...run, errors: [] }])).rejects.toThrow(/measurement/)
      await expect(verifyProfileMeasurementArtifacts(root, [{ ...run, errors: ["replacement"] }])).rejects.toThrow(/measurement/)
      await expect(verifyProfileMeasurementArtifacts(root, [{ ...run, usage: { total: 1 } }])).rejects.toThrow(/measurement/)
      await expect(verifyProfileMeasurementArtifacts(root, [{ ...run, repeat: 99 }])).rejects.toThrow(/measurement/)
      await writeFile(path.join(root, measurementArtifact.file), "{}")
      await expect(verifyProfileMeasurementArtifacts(root, [run])).rejects.toThrow(/measurement/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("rejects changed profile artifacts after measurement before grading", async () => {
    await expect(verifyProfileIdentity("before", async () => "after")).rejects.toThrow(/artifacts changed/)
    await expect(verifyProfileIdentity("before", async () => "before")).resolves.toBeUndefined()
  })
  it("durably reserves a profile dispatch before execution and rejects duplicate reservations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patchline-profile-ledger-"))
    try {
      const entry = profileDiagnosticSchedule()[0]!
      await reserveProfileDispatch(root, [], entry)
      expect(JSON.parse(await readFile(path.join(root, "profile-dispatch-00.json"), "utf8"))).toMatchObject({ index: 0, entry, state: "dispatched" })
      expect(await loadProfileDispatches(root)).toEqual([entry])
      await expect(reserveProfileDispatch(root, [], entry)).rejects.toThrow()
      await expect(reserveProfileDispatch(root, [entry], entry)).rejects.toThrow(/prefix/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("rejects dispatch ledger gaps and malformed records instead of treating them as unused authorization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patchline-profile-ledger-gap-"))
    try {
      await writeFile(path.join(root, "profile-dispatch-01.json"), "{}")
      await expect(loadProfileDispatches(root)).rejects.toThrow(/ledger/)
      await rm(path.join(root, "profile-dispatch-01.json"))
      await writeFile(path.join(root, "profile-dispatch-00.json"), "{")
      await expect(loadProfileDispatches(root)).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("requires explicit twelve-session authorization for profile diagnostics", () => {
    expect(() => parseOptions(["run-profiles"])).toThrow(/12/)
    expect(() => parseOptions(["run-profiles", "--max-sessions", "18"])).toThrow(/12/)
    expect(parseOptions(["run-profiles", "--max-sessions", "12"])).toMatchObject({ command: "run-profiles", maxSessions: 12, repeats: 2, steps: 8 })
    expect(() => parseOptions(["run-profiles", "--max-sessions", "12", "--repeats", "5"])).toThrow(/fixed design/)
  })
  it("requires profile resume input to be the output directory results file", () => {
    expect(() => parseOptions(["run-profiles", "--max-sessions", "12", "--out", "resume", "--input", "other/results.json"])).toThrow(/resume input/)
    expect(parseOptions(["run-profiles", "--max-sessions", "12", "--out", "resume", "--input", "resume/results.json"]).input).toBe(path.resolve("resume/results.json"))
  })
  it("pins the authorized profile diagnostic to twelve balanced sessions", () => {
    const schedule = profileDiagnosticSchedule()
    expect(schedule).toHaveLength(12)
    expect(new Set(schedule.map((entry) => JSON.stringify(entry))).size).toBe(12)
    expect(schedule.slice(0, 2).map((entry) => entry.toolProfile)).toEqual(["extended", "compact"])
    expect(schedule.slice(6, 8).map((entry) => entry.toolProfile)).toEqual(["compact", "extended"])
    for (const task of ["targeted", "large-file", "three-files"]) expect(schedule.filter((entry) => entry.taskId === task)).toHaveLength(4)
  })
  it("does not label interrupted tool streams complete", () => {
    const parser = new StreamToolCalls()
    parser.push('data: {"choices":[]}\n\n')
    expect(parser.finish(false).complete).toBe(false)
  })
  it("separates choice indices and caps the number of reconstructed calls", () => {
    const parser = new StreamToolCalls()
    for (let index = 0; index < 129; index++) {
      parser.push(`data: ${JSON.stringify({ choices: [{ index, delta: { tool_calls: [{ index: 0, function: { name: "read", arguments: "{}" } }] } }] })}\n\n`)
    }
    const result = parser.finish()
    expect(result.complete).toBe(false)
    expect(result.calls).toHaveLength(128)
    expect(result.calls.every((call) => call.validJson && !call.readPathValid)).toBe(true)
  })
  it("bounds tool telemetry and tolerates malformed provider frames", () => {
    for (const value of ["null", '{"choices":{}}', '{"choices":[null]}', '{"choices":[{"delta":{"tool_calls":{}}}]}']) {
      const parser = new StreamToolCalls()
      expect(() => parser.push(`data: ${value}\n\n`)).not.toThrow()
      expect(parser.finish().complete).toBe(false)
    }
    const parser = new StreamToolCalls()
    parser.push("x".repeat(2_000_001))
    expect(parser.finish()).toEqual({ complete: false, calls: [] })
  })
  it("summarizes fragmented provider tool arguments without persisting their content", () => {
    const parser = new StreamToolCalls()
    const frame = (index: number, name: string | undefined, args: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index, function: { name, arguments: args } }] } }] })}\n\n`
    const text = frame(0, "read", '{"filePath":"secret.ts",') + frame(0, undefined, '"anchor":"private","offset":1}') + frame(1, "read", "{}")
    for (let i = 0; i < text.length; i += 7) parser.push(text.slice(i, i + 7))
    const result = parser.finish()
    expect(result.complete).toBe(true)
    expect(result.calls).toMatchObject([{ name: "read", validJson: true, readPathValid: true, anchorWithOffset: true }, { name: "read", validJson: true, readPathValid: false, anchorWithOffset: false }])
    expect(JSON.stringify(result)).not.toMatch(/secret|private/)
    expect(result.calls[1]!.argumentsSha256).toBe(createHash("sha256").update("{}").digest("hex"))
  })
  it("reconstructs interleaved three-call argument streams at every transport split", () => {
    const args = ["greeting.mjs", "app.mjs", "preview.mjs"].map((filePath) => JSON.stringify({ filePath, limit: 40 }))
    const frame = (calls: unknown[]) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: calls } }] })}\r\n\r\n`
    const stream = frame(args.map((_, index) => ({ index, id: `call-${index}`, function: { name: "read", arguments: "" } })))
      + [2, 0, 1].map((index) => frame([{ index, function: { arguments: args[index]!.slice(0, 12) } }])).join("")
      + frame([1, 2, 0].map((index) => ({ index, function: { arguments: args[index]!.slice(12) } })))
      + "data: [DONE]\r\n\r\n"
    for (let split = 0; split <= stream.length; split++) {
      const parser = new StreamToolCalls()
      parser.push(stream.slice(0, split))
      parser.push(stream.slice(split))
      expect(parser.finish()).toMatchObject({ complete: true, calls: args.map((value) => ({ name: "read", argumentsBytes: Buffer.byteLength(value), argumentsSha256: createHash("sha256").update(value).digest("hex"), validJson: true, readPathValid: true, anchorWithOffset: false })) })
    }
  })
  it("distinguishes missing, empty and non-string streamed arguments without retaining content", () => {
    const parser = new StreamToolCalls()
    for (const fn of [{ name: "read" }, { arguments: "" }, { arguments: { filePath: "private" } }]) parser.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 2, function: fn }] } }] })}\n\n`)
    expect(parser.finish().calls[0]).toMatchObject({ argumentFragments: 1, emptyArgumentFragments: 1, nonStringArgumentFragments: 1, missingArgumentFragments: 1 })
    expect(JSON.stringify(parser.finish())).not.toContain("private")
  })
  it("rejects an invalid attribution manifest before local checks or credentials", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-attribution-preflight-"))
    try {
      const input = path.join(root, "manifest.json")
      await writeFile(input, "null")
      const result = await runProcess(process.execPath, ["--import", "tsx", "benchmarks/comparison/runner.ts", "run-attribution", "--input", input, "--max-sessions", "18", "--provider-config", path.join(root, "missing.json"), "--out", path.join(root, "out")], { cwd: process.cwd(), env: process.env, timeoutMs: 30000 })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("Attribution preparation design changed or is invalid")
      expect(result.stdout).not.toContain("Running local safety checks")
      await expect(readFile(path.join(root, "out", "results.json"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 35000)
  it("reports attribution separately from two-mode completeness", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-attribution-report-"))
    try {
      const input = path.join(root, "input.json")
      await writeFile(input, JSON.stringify({ stage: "attribution-pilot", model: "controlled/model", notes: ["cache uncontrolled"], preparation: { corpusSha256: "pinned-corpus" }, runs: [{ taskId: "<script>alert(1)</script>", treatment: "stock", repeat: 0, success: false, durationMs: 10, usage: null, gradingStatus: "complete" }] }))
      const result = await runProcess(process.execPath, ["--import", "tsx", "benchmarks/comparison/runner.ts", "report", "--input", input, "--out", path.join(root, "out")], { cwd: process.cwd(), env: process.env, timeoutMs: 30000 })
      expect(result.code, result.stderr).toBe(0)
      const report = JSON.parse(await readFile(path.join(root, "out", "results.json"), "utf8"))
      expect(report.analysis.acceptance).toBe("not-established-pilot")
      expect(report.analysis.integrity.missing).toHaveLength(18)
      expect(report.analysis.originalVsStock).toBeNull()
      const html = await readFile(path.join(root, "out", "index.html"), "utf8")
      expect(html).toContain("not-established-pilot")
      expect(html).toContain("originalVsStock")
      expect(html).toContain("gradingStatus")
      expect(html).toContain("controlled/model")
      expect(html).toContain("pinned-corpus")
      expect(html).toContain("cache uncontrolled")
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
      expect(html).not.toContain("<script>")
      expect(await readFile(path.join(root, "out", "results.csv"), "utf8")).toContain('\"<script>alert(1)</script>\",\"stock\",\"0\",\"false\",\"10\",\"\"')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("prepares attribution through the CLI without provider configuration or executable hosts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-prepare-cli-"))
    try {
      await mkdir(path.join(root, "dist"))
      const paths = ["stock", "host", "dist/original", "dist/optimized"].map((name) => path.join(root, name))
      for (const file of paths) await writeFile(file, file)
      const args = ["--import", "tsx", "benchmarks/comparison/runner.ts", "prepare-attribution", "--stock-bin", paths[0]!, "--patchline-bin", paths[1]!, "--original-plugin", paths[2]!, "--optimized-plugin", paths[3]!, "--out", path.join(root, "out"), "--provider-config", path.join(root, "missing-credentials.json")]
      const result = await runProcess(process.execPath, args, { cwd: process.cwd(), env: process.env, timeoutMs: 30000 })
      expect(result.code, result.stderr).toBe(0)
      const filename = path.join(root, "out", "attribution-manifest.json")
      const before = await readFile(filename, "utf8")
      expect(JSON.parse(before)).toMatchObject({ executionAuthorized: false })
      const retry = await runProcess(process.execPath, args, { cwd: process.cwd(), env: process.env, timeoutMs: 30000 })
      expect(retry.code).not.toBe(0)
      expect(await readFile(filename, "utf8")).toBe(before)
      await writeFile(paths[3]!, "changed optimized plugin")
      const execute = await runProcess(process.execPath, ["--import", "tsx", "benchmarks/comparison/runner.ts", "run-attribution", "--input", filename, "--max-sessions", "18", "--stock-bin", paths[0]!, "--patchline-bin", paths[1]!, "--original-plugin", paths[2]!, "--optimized-plugin", paths[3]!, "--provider-config", path.join(root, "missing-credentials.json"), "--out", path.join(root, "execution")], { cwd: process.cwd(), env: process.env, timeoutMs: 30000 })
      expect(execute.code).not.toBe(0)
      expect(execute.stderr).toContain("Attribution artifacts changed")
      expect(execute.stderr).not.toContain("missing-credentials")
      await expect(readFile(path.join(root, "execution", "results.json"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 35000)
  it("refuses preparation output inside a measured plugin distribution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-output-boundary-"))
    try {
      const input = { stockBinary: path.join(root, "stock"), integratedBinary: path.join(root, "host"), originalPlugin: path.join(root, "original"), optimizedPlugin: path.join(root, "optimized") }
      for (const [key, file] of Object.entries(input)) await writeFile(file, key)
      const artifacts = await fingerprintAttributionArtifacts(input)
      const output = path.join(root, "manifest.json")
      await expect(saveAttributionManifest(output, input, artifacts)).rejects.toThrow(/inside.*distribution/)
      await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("fingerprints explicit attribution artifacts and rejects identical plugin contents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-attribution-"))
    try {
      await mkdir(path.join(root, "dist"))
      const input = { stockBinary: path.join(root, "stock"), integratedBinary: path.join(root, "host"), originalPlugin: path.join(root, "dist", "original"), optimizedPlugin: path.join(root, "dist", "optimized") }
      for (const [key, file] of Object.entries(input)) await writeFile(file, key)
      const artifacts = await fingerprintAttributionArtifacts(input)
      expect(artifacts[1]!.dependencies).toBeNull()
      const absentManifest = await saveAttributionManifest(path.join(root, "absent-dependencies.json"), input, artifacts)
      await mkdir(path.join(root, "node_modules"))
      await writeFile(path.join(root, "node_modules", "dependency.js"), "original dependency")
      await expect(verifyAttributionManifest(absentManifest, input)).rejects.toThrow(/changed/)
      const withDependencies = await fingerprintAttributionArtifacts(input)
      artifacts.splice(0, artifacts.length, ...withDependencies)
      await expect(saveAttributionManifest(path.join(root, "node_modules", "manifest.json"), input, artifacts)).rejects.toThrow(/inside.*measured/)
      expect(artifacts).toHaveLength(3)
      expect(artifacts[1]!.binary).toEqual(artifacts[2]!.binary)
      expect(artifacts[1]!.plugin?.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(artifacts[1]!.plugin?.sha256).not.toBe(artifacts[2]!.plugin?.sha256)
      expect(artifacts[1]!.distribution?.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(artifacts[1]!.dependencies?.sha256).toMatch(/^[a-f0-9]{64}$/)
      const manifestPath = path.join(root, "manifest.json")
      await saveAttributionManifest(manifestPath, input, artifacts)
      const saved = await readFile(manifestPath, "utf8")
      await writeFile(path.join(root, "node_modules", "dependency.js"), "changed dependency")
      await expect(verifyAttributionManifest(JSON.parse(saved), input)).rejects.toThrow(/changed/)
      await writeFile(path.join(root, "node_modules", "dependency.js"), "original dependency")
      const dispatched: string[] = []
      const checkpoints: number[] = []
      await expect(dispatchAttributionSchedule(JSON.parse(saved), input, async (entry) => {
        if (entry.treatment === "original") throw new Error("session failed")
        return entry.treatment
      }, async (results) => { checkpoints.push(results.length) })).rejects.toThrow("session failed")
      expect(checkpoints).toEqual([1])
      const checkpointDispatches: string[] = []
      await expect(dispatchAttributionSchedule(JSON.parse(saved), input, async (entry) => {
        checkpointDispatches.push(entry.treatment)
        return entry
      }, async () => { throw new Error("checkpoint persistence failed") })).rejects.toThrow("checkpoint persistence failed")
      expect(checkpointDispatches).toEqual(["stock"])
      const bindings: string[] = []
      await dispatchAttributionSchedule(JSON.parse(saved), input, async (entry, artifact) => {
        expect(artifact.treatment).toBe(entry.treatment)
        bindings.push(artifact.binary.path)
      })
      expect(bindings[0]).toBe(await import("node:fs/promises").then((fs) => fs.realpath(input.stockBinary)))
      const detachedManifest = JSON.parse(saved)
      await dispatchAttributionSchedule(detachedManifest, input, async (_entry, artifact) => {
        artifact.binary.path = "callback-local mutation"
      })
      expect(detachedManifest).toEqual(JSON.parse(saved))
      const controller = new AbortController()
      const cancelledDispatches: string[] = []
      await expect(dispatchAttributionSchedule(JSON.parse(saved), input, async (entry) => {
        cancelledDispatches.push(entry.treatment)
        controller.abort(new Error("pilot cancelled"))
      }, undefined, controller.signal)).rejects.toThrow("pilot cancelled")
      expect(cancelledDispatches).toEqual(["stock"])
      await expect(dispatchAttributionSchedule(JSON.parse(saved), input, async (entry) => {
        dispatched.push(entry.treatment)
        await writeFile(input.optimizedPlugin, "mutated after first dispatch")
      })).rejects.toThrow(/changed/)
      expect(dispatched).toEqual(["stock"])
      await writeFile(input.optimizedPlugin, "optimizedPlugin")
      const dispatchedResults = await dispatchAttributionSchedule(JSON.parse(saved), input, async (entry) => ({ ...entry, success: false, usage: null }))
      expect(dispatchedResults).toEqual(JSON.parse(saved).schedule.map((entry: object) => ({ ...entry, success: false, usage: null })))
      await expect(verifyAttributionManifest(JSON.parse(saved), input)).resolves.toBeUndefined()
      const verification = await runProcess(process.execPath, ["--import", "tsx", "benchmarks/comparison/runner.ts", "verify-attribution", "--input", manifestPath, "--stock-bin", input.stockBinary, "--patchline-bin", input.integratedBinary, "--original-plugin", input.originalPlugin, "--optimized-plugin", input.optimizedPlugin], { cwd: process.cwd(), env: process.env, timeoutMs: 30000 })
      expect(verification.code, verification.stderr).toBe(0)
      expect(verification.stdout).toContain("Attribution preparation verified")
      expect(JSON.parse(saved).harnessTree.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.parse(saved).sourceTree.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.parse(saved).lockfileSha256).toMatch(/^[a-f0-9]{64}$/)
      await expect(verifyAttributionManifest({ ...JSON.parse(saved), sourceTree: { sha256: "stale" } }, input)).rejects.toThrow(/source.*changed/i)
      await expect(verifyAttributionManifest({ ...JSON.parse(saved), lockfileSha256: "stale" }, input)).rejects.toThrow(/lockfile.*changed/i)
      await expect(verifyAttributionManifest({ ...JSON.parse(saved), harnessTree: { sha256: "stale" } }, input)).rejects.toThrow(/harness.*changed/i)
      await expect(verifyAttributionManifest({ ...JSON.parse(saved), schedule: [] }, input)).rejects.toThrow(/design/)
      await expect(verifyAttributionManifest({ ...JSON.parse(saved), model: "different/model" }, input)).rejects.toThrow(/design/)
      await expect(verifyAttributionManifest(null as never, input)).rejects.toThrow(/design/)
      expect(JSON.parse(saved)).toMatchObject({ schemaVersion: 1, stage: "attribution-pilot", executionAuthorized: false })
      expect(JSON.parse(saved).schedule).toHaveLength(18)
      expect(JSON.parse(saved)).toMatchObject({
        model: "omniroute/vilao/gpt-6.1-sol", temperature: 0,
        limits: { sessions: 18, steps: 8, timeoutMs: 180000 },
        cacheControl: "uncontrolled-provider-cache",
        corpusSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(JSON.parse(saved).corpusSha256).toBe(createHash("sha256").update(JSON.stringify(comparisonTasks)).digest("hex"))
      await expect(saveAttributionManifest(manifestPath, input, artifacts)).rejects.toThrow()
      expect(await readFile(manifestPath, "utf8")).toBe(saved)
      await writeFile(path.join(root, "dist", "imported.js"), "export const changed = true")
      await expect(verifyAttributionManifest(JSON.parse(saved), input)).rejects.toThrow(/changed/)
      await expect(saveAttributionManifest(path.join(root, "dependency-stale.json"), input, artifacts)).rejects.toThrow(/changed/)
      await expect(readFile(path.join(root, "dependency-stale.json"))).rejects.toMatchObject({ code: "ENOENT" })
      await writeFile(input.optimizedPlugin, "changed")
      await expect(saveAttributionManifest(path.join(root, "stale.json"), input, artifacts)).rejects.toThrow(/changed/)
      await expect(readFile(path.join(root, "stale.json"))).rejects.toMatchObject({ code: "ENOENT" })
      await writeFile(input.optimizedPlugin, "originalPlugin")
      await expect(fingerprintAttributionArtifacts(input)).rejects.toThrow(/identical plugin/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("fingerprints the corpus and source in offline reports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-offline-provenance-"))
    try {
      const result = await runProcess(process.execPath, ["--import", "tsx", "benchmarks/comparison/runner.ts", "check", "--out", root], { cwd: process.cwd(), env: process.env, timeoutMs: 30000 })
      expect(result.code, result.stderr).toBe(0)
      const report = JSON.parse(await readFile(path.join(root, "results.json"), "utf8"))
      expect(report.environment.corpusSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(report.environment.sourceTree.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(report.environment.benchmarkTree.sha256).toMatch(/^[a-f0-9]{64}$/)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 35000)
  it("detects agent staging and a removed Git index even when working files are unchanged", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-index-"))
    try {
      await materialize(root, { "file.txt": "original\n" })
      await initializeFixtureRepository(root)
      const before = await gitIndexFingerprint(root)
      expect(before).toMatch(/^[a-f0-9]{64}$/)
      await runProcess("git", ["status", "--porcelain"], { cwd: root, env: fixtureGitEnvironment(), timeoutMs: 10000 })
      expect(await gitIndexFingerprint(root)).toBe(before)
      await writeFile(path.join(root, "file.txt"), "changed\n")
      expect(await gitIndexFingerprint(root)).toBe(before)
      const staged = await runProcess("git", ["add", "--all"], { cwd: root, env: fixtureGitEnvironment(), timeoutMs: 10000 })
      expect(staged.code).toBe(0)
      expect(await gitIndexFingerprint(root)).not.toBe(before)
      await rm(path.join(root, ".git", "index"))
      expect(await gitIndexFingerprint(root)).toBe(null)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("starts the dirty-worktree task with actual user edits and rejects their loss", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-dirty-task-"))
    try {
      const task = comparisonTasks.find((candidate) => candidate.id === "dirty-worktree")!
      expect(task).toBeDefined()
      const workspace = path.join(root, "workspace")
      await mkdir(workspace)
      await prepareTaskWorkspace(task, workspace)
      const dirty = await runProcess("git", ["diff", "--", "settings.mjs"], { cwd: workspace, env: fixtureGitEnvironment(), timeoutMs: 10000 })
      expect(dirty.stdout).toContain("user-owned setting")
      const indexBefore = await runProcess("git", ["show", ":settings.mjs"], { cwd: workspace, env: fixtureGitEnvironment(), timeoutMs: 10000 })
      await materialize(workspace, task.expected)
      expect((await evaluateTask(task, workspace, root)).preservationSuccess).toBe(true)
      await writeFile(path.join(workspace, "notes.txt"), "Project note: preserve this file exactly.\n")
      expect((await evaluateTask(task, workspace, root)).preservationSuccess).toBe(false)
      const indexAfter = await runProcess("git", ["show", ":settings.mjs"], { cwd: workspace, env: fixtureGitEnvironment(), timeoutMs: 10000 })
      expect(indexAfter.stdout).toBe(indexBefore.stdout)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("rejects stale distribution bytes without rebuilding or changing the measured tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-build-"))
    try {
      await materialize(root, {
        "src/index.ts": "current source",
        "dist/index.js": "stale output",
        "scripts/build.mjs": "import {mkdir, readFile, writeFile} from 'node:fs/promises'; await mkdir('dist', {recursive:true}); await writeFile('dist/index.js', await readFile('src/index.ts'));",
        "package.json": "{\"type\":\"module\"}",
        "tsconfig.json": "{}",
        "tsconfig.build.json": "{}",
      })
      await mkdir(path.join(root, "node_modules"))
      await expect(verifyReproducibleBuild(root)).rejects.toThrow(/does not match/)
      expect(await readFile(path.join(root, "dist/index.js"), "utf8")).toBe("stale output")
      await writeFile(path.join(root, "dist/index.js"), "current source")
      const proof = await verifyReproducibleBuild(root)
      expect(proof.rebuiltSha256).toBe((await fingerprintTree(path.join(root, "dist"))).sha256)
      await writeFile(path.join(root, "dist/extra.js"), "unexpected")
      await expect(verifyReproducibleBuild(root)).rejects.toThrow(/does not match/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("fingerprints untracked source bytes and file names deterministically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-tree-"))
    try {
      await materialize(root, { "b.ts": "two", "nested/a.ts": "one" })
      const first = await fingerprintTree(root)
      expect(await fingerprintTree(root)).toEqual(first)
      await writeFile(path.join(root, "untracked.ts"), "new")
      const added = await fingerprintTree(root)
      expect(added.sha256).not.toBe(first.sha256)
      await writeFile(path.join(root, "untracked.ts"), "changed")
      expect((await fingerprintTree(root)).sha256).not.toBe(added.sha256)
      expect(first.files.map((file) => file.path)).toEqual(["b.ts", "nested/a.ts"])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("labels incomplete declared full series explicitly in both report formats", () => {
    const report = { stage: "full", runs: [], local: [], model: "fixture", notes: [], integrity: { complete: false, missing: ["a"] } }
    expect(markdownReport(report)).toContain("НЕПОЛНАЯ СЕРИЯ")
    expect(renderReport(report)).toContain("НЕПОЛНАЯ СЕРИЯ")
    expect(markdownReport({ ...report, integrity: { complete: true } })).not.toContain("НЕПОЛНАЯ СЕРИЯ")
  })
  it("renders the declared projection session count instead of a fixed corpus size", () => {
    const report = { stage: "pilot", runs: [], model: "fixture", notes: [], analysis: { fullProjection: { sessions: 130, tokens: 1000, durationMs: 60000 } } }
    expect(markdownReport(report)).toContain("Оценка 130 сессий")
    expect(markdownReport(report)).not.toContain("Оценка 120 сессий")
    expect(renderReport(report)).toContain("130 СЕССИЙ · ЭКСТРАПОЛЯЦИЯ")
    expect(renderReport(report)).not.toContain("120 СЕССИЙ · ЭКСТРАПОЛЯЦИЯ")
  })
  it.each([undefined, -1, 0, 1.5, "</script><img src=x onerror=alert(1)>"])("does not render an invalid projection count as markup (%s)", (sessions) => {
    const html = renderReport({ stage: "pilot", runs: [], analysis: { fullProjection: { sessions } } })
    expect(html).toContain("— СЕССИЙ · ЭКСТРАПОЛЯЦИЯ")
    expect(html).not.toContain("</script><img")
  })
  it("does not describe a full experiment as a pilot", () => {
    const report = { stage: "full", runs: [], model: "fixture", notes: [], integrity: { complete: true } }
    expect(markdownReport(report)).not.toContain("Пилот предназначен")
    expect(markdownReport(report)).toContain("выбранными задачами, моделью и условиями")
  })
  it("prevents evaluated modules from replacing the hidden assertion library", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-assertion-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, task.before)
      await writeFile(path.join(workspace, "pricing.mjs"), 'import assert from "node:assert/strict"; assert.equal = () => {};\n' + task.before["pricing.mjs"])
      expect((await evaluateTask(task, workspace, root)).functionalSuccess).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("writes immutable per-attempt measurement artifacts without overwriting prior runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-artifact-"))
    try {
      const measurement = { taskId: "a", mode: "stock", repeat: 0, usage: { total: 42 } }
      const artifact = await saveMeasurementArtifact(root, measurement)
      expect(JSON.parse(await readFile(path.join(root, artifact.file), "utf8"))).toEqual(measurement)
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
      const second = await saveMeasurementArtifact(root, measurement)
      expect(second.file).not.toBe(artifact.file)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("isolates fixture Git from inherited repository and configuration overrides", () => {
    const env = fixtureGitEnvironment({ PATH: "bin", GIT_DIR: "user-repository", GIT_INDEX_FILE: "user-index", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "filter.unsafe.clean", GIT_CONFIG_VALUE_0: "unsafe", GIT_CONFIG_GLOBAL: "user-config" })
    expect(env.PATH).toBe("bin")
    expect(env.GIT_DIR).toBeUndefined()
    expect(env.GIT_INDEX_FILE).toBeUndefined()
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined()
    expect(env.GIT_CONFIG_COUNT).toBe("0")
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1")
    expect(env.GIT_CONFIG_GLOBAL).not.toBe("user-config")
  })
  it("persists paid measurements before grading and retains grading failures", async () => {
    const snapshots: string[] = []
    const report = { runs: [] as Record<string, any>[] }
    const run = { durationMs: 120, usage: { total: 456 }, errors: [], success: false }
    await recordMeasuredRun(report, run, async () => { snapshots.push(JSON.stringify(report)) }, async () => {
      expect(snapshots).toHaveLength(1)
      expect(JSON.parse(snapshots[0]!).runs[0].gradingStatus).toBe("pending")
      throw new Error("grader exceeded budget")
    }, true)
    expect(snapshots).toHaveLength(2)
    expect(report.runs[0]).toMatchObject({ usage: { total: 456 }, gradingStatus: "error", success: false, evaluation: null })
    expect(report.runs[0]!.errors).toContain("Evaluation failed: grader exceeded budget")
  })
  it("tracks fixture baselines so git diff exposes edits and deletions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-git-"))
    try {
      await materialize(root, { "main.mjs": "export const value = 1\n", "remove.txt": "keep\n" })
      await initializeFixtureRepository(root)
      await writeFile(path.join(root, "main.mjs"), "export const value = 2\n")
      await rm(path.join(root, "remove.txt"))
      const diff = await runProcess("git", ["diff", "--", "main.mjs", "remove.txt"], { cwd: root, env: process.env, timeoutMs: 5000 })
      expect(diff.code).toBe(0)
      expect(diff.stdout).toContain("-export const value = 1")
      expect(diff.stdout).toContain("+export const value = 2")
      expect(diff.stdout).toContain("deleted file")
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("checks real dirty fixture whitespace without changing the staged baseline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-dirty-"))
    try {
      await materialize(root, { "main.mjs": "export const value = 1\n", "notes.txt": "user note\n" })
      await initializeFixtureRepository(root)
      await writeFile(path.join(root, "notes.txt"), "user note changed before task\n")
      await writeFile(path.join(root, "main.mjs"), "export const value = 2 \n")
      const checked = await runProcess("git", ["diff", "--check"], { cwd: root, env: fixtureGitEnvironment(), timeoutMs: 5000 })
      expect(checked.code).not.toBe(0)
      expect(checked.stdout).toContain("trailing whitespace")
      const baseline = await runProcess("git", ["show", ":notes.txt"], { cwd: root, env: fixtureGitEnvironment(), timeoutMs: 5000 })
      expect(baseline.stdout).toBe("user note\n")
      expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("user note changed before task\n")
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("terminates timed-out process trees and returns bounded output", async () => {
    const result = await runProcess(process.execPath, ["-e", "console.log('started');setInterval(()=>{},1000)"], { cwd: process.cwd(), env: process.env, timeoutMs: 300 })
    expect(result.timedOut).toBe(true)
    expect(result.stdout).toContain("started")
    expect(result.durationMs).toBeLessThan(8000)
  })
  it("bounds captured stdout even when the final chunk crosses the output limit", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(9_000_000))"], { cwd: process.cwd(), env: process.env, timeoutMs: 5000 })
    expect(result.outputLimited).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(8_000_000)
  })
  it("collects fragmented SSE usage without estimating missing usage", () => {
    const stream = new StreamUsage()
    stream.push('data: {"usage":{"prompt_tokens":100,')
    stream.push('"completion_tokens":30}}\r\n\r\ndata: [DONE]\n\n')
    expect(stream.finish()?.total).toBe(130)
    expect(new StreamUsage().finish()).toBeNull()
  })

  it("accepts usage-only SSE frames without inventing tool calls", () => {
    const stream = new StreamToolCalls()
    stream.push('data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n')
    expect(stream.finish()).toEqual({ complete: true, calls: [] })
  })

  it("forwards real streaming bytes and records provider calls without credentials", async () => {
    const upstream = createServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer do-not-persist")
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "read", arguments: '{"filePath":"confidential.ts"}' } }] } }] })}\n\n`)
      res.end('data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const address = upstream.address() as { port: number }
    const relay = await createRelay({ baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "do-not-persist", maxRequests: 2, timeoutMs: 5000 })
    try {
      const messages = [{ role: "system", content: "policy" }, { role: "developer", content: "rules" }, { role: "user", content: "Привет" }, { role: "tool", content: "source", tool_call_id: "a" }]
      const response = await fetch(`${relay.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "fixture", stream: true, tools: [{ function: { name: "read" } }], messages }) })
      expect(await response.text()).toContain("[DONE]")
      expect(relay.calls).toHaveLength(1)
      expect(relay.calls[0]?.usage?.total).toBe(12)
      expect(JSON.stringify(relay.calls)).not.toContain("do-not-persist")
      expect(relay.calls[0]?.tools).toEqual(["read"])
      expect(relay.calls[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/)
      expect(relay.calls[0]?.requestSections).toMatchObject({ messages: Buffer.byteLength(JSON.stringify(messages)), tools: expect.any(Number) })
      const bytes = (entries: unknown[]) => entries.reduce<number>((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0)
      expect(relay.calls[0]?.messageSections).toEqual({ systemBytes: bytes(messages.slice(0, 2)), historyBytes: bytes(messages.slice(2, 3)), toolResultBytes: bytes(messages.slice(3)), otherBytes: 0, messages: 4 })
      expect(JSON.stringify(relay.calls)).not.toContain("Привет")
      expect(JSON.stringify(relay.calls)).not.toContain("confidential.ts")
      expect(relay.calls[0]).toMatchObject({ responseToolCalls: { complete: true, calls: [{ name: "read", validJson: true, readPathValid: true }] } })
    } finally { await relay.close(); await new Promise<void>((resolve) => upstream.close(() => resolve())) }
  })

  it("executes hidden behavioral checks and detects created unrelated files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patchline-eval-test-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, task.before)
      const failed = await evaluateTask(task, workspace, root)
      expect(failed.functionalSuccess).toBe(false)
      await materialize(workspace, task.expected)
      expect((await evaluateTask(task, workspace, root)).functionalSuccess).toBe(true)
      await writeFile(path.join(workspace, "extra.txt"), "unrelated")
      const changed = await evaluateTask(task, workspace, root)
      expect(changed.comparison.unrelatedFiles).toEqual(["extra.txt"])
      expect(changed.preservationSuccess).toBe(false)
      expect(await readFile(path.join(workspace, "notes.txt"), "utf8")).toBe(task.before["notes.txt"])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("rejects early successful process exit before hidden assertions finish", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-exit-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, task.expected)
      const file = Object.keys(task.expected).find((name) => name.endsWith(".mjs"))!
      await writeFile(path.join(workspace, file), "process.exit(0)\n")
      const result = await evaluateTask(task, workspace, root)
      expect(result.functionalSuccess).toBe(false)
      expect(result.checks.some((check) => !check.passed)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("denies filesystem mutations during hidden checks and leaves fixture bytes intact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-mutation-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, task.expected)
      const result = await evaluateTask({ ...task, checks: [{ name: "mutating-check", code: 'await (await import("node:fs/promises")).writeFile(new URL("notes.txt", base), "changed")' }] }, workspace, root)
      expect(await readFile(path.join(workspace, "notes.txt"), "utf8")).toBe(task.expected["notes.txt"])
      expect(result.preservationSuccess).toBe(true)
      expect(result.functionalSuccess).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("denies hidden-check writes outside the observed fixture", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-outside-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, task.expected)
      const sentinel = path.join(root, "user-sentinel.txt")
      await writeFile(sentinel, "preserve")
      const result = await evaluateTask({ ...task, checks: [{ name: "outside-write", code: `await (await import('node:fs/promises')).writeFile(${JSON.stringify(sentinel)}, 'lost')` }] }, workspace, root)
      expect(await readFile(sentinel, "utf8")).toBe("preserve")
      expect(result.functionalSuccess).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("rejects collateral additions inside the intended file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-addition-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, task.expected)
      const file = Object.keys(task.expected).find((name) => name.endsWith(".mjs"))!
      await writeFile(path.join(workspace, file), task.expected[file] + "\nexport const unrelatedAddition = true\n")
      expect((await evaluateTask(task, workspace, root)).preservationSuccess).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("does not decode malformed UTF-8 into an apparently preserved replacement character", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-encoding-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      const files = { ...task.expected, "notes.txt": "\ufffd" }
      await materialize(workspace, files)
      await writeFile(path.join(workspace, "notes.txt"), Buffer.from([0xff]))
      const result = await evaluateTask({ ...task, before: { ...task.before, "notes.txt": "\ufffd" }, expected: files }, workspace, root)
      expect(result.preservationSuccess).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("rejects oversized evaluation files before loading them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-budget-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, task.expected)
      await writeFile(path.join(workspace, "oversized.bin"), Buffer.alloc(2_000_001))
      await expect(evaluateTask(task, workspace, root)).rejects.toThrow("Evaluation file byte budget exceeded")
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("includes nested .git directories in preservation checks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-nested-git-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, { ...task.expected, "src/.git/collateral.txt": "unexpected" })
      expect((await evaluateTask(task, workspace, root)).preservationSuccess).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("does not pass runner credentials to hidden-check children", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-env-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    const previous = process.env.COMPARISON_SECRET_REGRESSION
    process.env.COMPARISON_SECRET_REGRESSION = "must-not-inherit"
    try {
      await mkdir(workspace)
      await materialize(workspace, task.expected)
      const result = await evaluateTask({ ...task, checks: [{ name: "environment", code: 'assert.equal(process.env.COMPARISON_SECRET_REGRESSION, undefined)' }] }, workspace, root)
      expect(result.functionalSuccess).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.COMPARISON_SECRET_REGRESSION
      else process.env.COMPARISON_SECRET_REGRESSION = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it("accepts a correct alternative implementation within the intended byte region", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-alternative-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    try {
      await mkdir(workspace)
      await materialize(workspace, { ...task.expected, "pricing.mjs": task.expected["pricing.mjs"]!.replace("Math.min(100, Math.max(0, percent))", "Math.max(0, Math.min(percent, 100))") })
      const result = await evaluateTask(task, workspace, root)
      expect(result.functionalSuccess).toBe(true)
      expect(result.preservationSuccess).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("accepts a clamp statement in the targeted body while protecting its signature and surrounding code", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "comparison-targeted-body-"))
    const workspace = path.join(root, "workspace")
    const task = comparisonTasks.find((candidate) => candidate.id === "targeted")!
    const alternative = task.before["pricing.mjs"]!.replace("  return Math.round", "  percent = Math.min(100, Math.max(0, percent))\n  return Math.round")
    try {
      await mkdir(workspace)
      await materialize(workspace, { ...task.before, "pricing.mjs": alternative })
      const result = await evaluateTask(task, workspace, root)
      expect(result.functionalSuccess).toBe(true)
      expect(result.preservationSuccess).toBe(true)
      for (const changed of [
        alternative.replace("// Prices are in integer cents.", "// Changed comment."),
        alternative.replace("discountedPrice(cents, percent)", "discountedPrice(cents, percent = 0)"),
        alternative.replace("`${cents} cents`", "`${cents} USD`"),
      ]) {
        await materialize(workspace, { ...task.before, "pricing.mjs": changed })
        expect((await evaluateTask(task, workspace, root)).preservationSuccess).toBe(false)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it("renders hostile source as inert text and makes missing measurements visible", () => {
    const html = renderReport({ schemaVersion: 1, stage: "pilot", createdAt: "2026-10-16", model: "</script><img src=x onerror=alert(1)>", runs: [], local: [], environment: {}, limits: { maxSessions: 6 }, notes: [] })
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("\\u003c/script>")
    expect(html).toContain("Нет данных")
    expect(html).toContain('lang="ru"')
    expect(html).not.toMatch(/<script[^>]+src=/)
    const javascript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(javascript).toBeTruthy()
    expect(() => new Script(javascript!)).not.toThrow()
  })
})
