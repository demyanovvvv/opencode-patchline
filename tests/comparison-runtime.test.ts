import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { Script } from "node:vm"
import { describe, expect, it } from "vitest"
import { createRelay, StreamUsage } from "../benchmarks/comparison/relay.js"
import { evaluateTask, materialize, prepareTaskWorkspace, recordMeasuredRun, saveMeasurementArtifact } from "../benchmarks/comparison/evaluate.js"
import { comparisonTasks } from "../benchmarks/comparison/tasks.js"
import { markdownReport, renderReport } from "../benchmarks/comparison/report.js"
import { fingerprintTree, fixtureGitEnvironment, gitIndexFingerprint, initializeFixtureRepository, runProcess, verifyReproducibleBuild } from "../benchmarks/comparison/process.js"
import { fingerprintAttributionArtifacts, saveAttributionManifest, verifyAttributionManifest } from "../benchmarks/comparison/config.js"

describe("comparison runtime", () => {
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
      expect(artifacts).toHaveLength(3)
      expect(artifacts[1]!.binary).toEqual(artifacts[2]!.binary)
      expect(artifacts[1]!.plugin?.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(artifacts[1]!.plugin?.sha256).not.toBe(artifacts[2]!.plugin?.sha256)
      expect(artifacts[1]!.distribution?.sha256).toMatch(/^[a-f0-9]{64}$/)
      const manifestPath = path.join(root, "manifest.json")
      await saveAttributionManifest(manifestPath, input, artifacts)
      const saved = await readFile(manifestPath, "utf8")
      await expect(verifyAttributionManifest(JSON.parse(saved), input)).resolves.toBeUndefined()
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

  it("forwards real streaming bytes and records provider calls without credentials", async () => {
    const upstream = createServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer do-not-persist")
      res.writeHead(200, { "content-type": "text/event-stream" })
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
