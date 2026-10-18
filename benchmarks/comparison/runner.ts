import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "jsonc-parser"
import { fingerprintAttributionArtifacts, saveAttributionManifest, verifyAttributionManifest, isolatedConfig, isolatedEnvironment, parseOptions, profileDiagnosticSchedule, reserveProfileDispatch, loadProfileDispatches, verifyProfileIdentity, validateProfileResumeRuns, verifyProfileMeasurementArtifacts, profileSettingsFingerprint } from "./config.js"
import { evaluateTask, materialize, prepareTaskWorkspace, recordMeasuredRun, saveMeasurementArtifact } from "./evaluate.js"
import { localChecks, measureToolProfiles } from "./local.js"
import { collectEvents, sumUsage, type Json, type Mode } from "./metrics.js"
import { fingerprintTree, fixtureGitEnvironment, gitIndexFingerprint, runProcess, verifyReproducibleBuild } from "./process.js"
import { createRelay } from "./relay.js"
import { markdownReport, renderReport } from "./report.js"
import { comparisonTasks } from "./tasks.js"
import { attributionSummary, experimentSummary, validateManifest, profileDiagnosticSummary } from "./analysis.js"
import { loadAttributionDispatches, reserveAttributionDispatch, validateAttributionResumeRuns } from "./config.js"

const repository = fileURLToPath(new URL("../../", import.meta.url))
const options = parseOptions(process.argv.slice(2))
const tempRoot = options.tempRoot ?? os.tmpdir()
await access(tempRoot)

async function save(report: Json) {
  if (report.stage === "profile-diagnostic") {
    report.analysis = profileDiagnosticSummary(report.runs)
    report.integrity = report.analysis.integrity
    await mkdir(options.out, { recursive: true })
    await writeFile(path.join(options.out, "results.json"), JSON.stringify(report, null, 2) + "\n")
    const escaped = JSON.stringify(report.analysis, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    await writeFile(path.join(options.out, "index.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Patchline profile diagnostic</title><h1>Extended / compact: диагностика</h1><p>Описательные результаты; acceptance не установлен.</p><pre>${escaped}</pre></html>\n`)
    return
  }
  if (report.stage === "attribution-pilot") {
    report.analysis = attributionSummary(report.runs)
    report.integrity = report.analysis.integrity
    await mkdir(options.out, { recursive: true })
    const escapedAnalysis = JSON.stringify(report, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    await writeFile(path.join(options.out, "index.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Patchline attribution pilot</title><h1>Трёхрежимный attribution-пилот</h1><p>Описательные результаты. Принятие оптимизации не установлено.</p><pre>${escapedAnalysis}</pre></html>\n`)
    await writeFile(path.join(options.out, "results.json"), JSON.stringify(report, null, 2) + "\n")
    const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`
    await writeFile(path.join(options.out, "results.csv"), [
      "task,treatment,repeat,success,duration_ms,tokens",
      ...report.runs.map((run: Json) => [run.taskId, run.treatment, run.repeat, run.success, run.durationMs, run.usage?.total].map(csvCell).join(",")),
    ].join("\n") + "\n")
    await writeFile(path.join(options.out, "summary.md"), [
      "# Patchline three-treatment attribution pilot",
      "Descriptive pilot only: performance acceptance is not established.",
      `Complete: ${report.integrity.complete}`,
      "```json", JSON.stringify(report.analysis, null, 2), "```", "",
    ].join("\n"))
    return
  }
  report.integrity = validateManifest(report.manifest, report.runs)
  report.analysis = experimentSummary(report.runs.map((run: Json) => ({ taskId: run.taskId, repeat: run.repeat, mode: run.mode, durationMs: run.durationMs, tokens: run.usage?.total ?? null, success: run.success })), comparisonTasks.length * 2 * 5)
  await mkdir(options.out, { recursive: true })
  await writeFile(path.join(options.out, "results.json"), JSON.stringify(report, null, 2) + "\n")
  await writeFile(path.join(options.out, "index.html"), renderReport(report))
  await writeFile(path.join(options.out, "summary.md"), markdownReport(report))
  const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`
  await writeFile(path.join(options.out, "results.csv"), ["task,repeat,mode,success,duration_ms,tokens,input,output,reasoning,cache_read,cache_write,precision,tool_calls,tool_errors", ...report.runs.map((r: Json) => [r.taskId, r.repeat + 1, r.mode, r.success, r.durationMs, r.usage?.total, r.usage?.input, r.usage?.output, r.usage?.reasoning, r.usage?.cacheRead, r.usage?.cacheWrite, r.evaluation?.comparison.precision, r.events.tools.length, r.events.toolErrors].map(csv).join(","))].join("\n") + "\n")
}

if (options.command === "verify-attribution") {
  if (!options.input) throw new Error("verify-attribution requires --input <attribution-manifest.json>")
  const input = { stockBinary: options.stockBin!, integratedBinary: options.patchlineBin!, originalPlugin: options.originalPlugin!, optimizedPlugin: options.optimizedPlugin! }
  await verifyAttributionManifest(JSON.parse(await readFile(options.input, "utf8")), input)
  console.log("Attribution preparation verified; no provider requests authorized or executed")
} else if (options.command === "prepare-attribution") {
  const input = { stockBinary: options.stockBin ?? "", integratedBinary: options.patchlineBin ?? "", originalPlugin: options.originalPlugin ?? "", optimizedPlugin: options.optimizedPlugin ?? "" }
  const artifacts = await fingerprintAttributionArtifacts(input)
  await mkdir(options.out, { recursive: true })
  await saveAttributionManifest(path.join(options.out, "attribution-manifest.json"), input, artifacts)
  console.log(`Preparation only: ${path.join(options.out, "attribution-manifest.json")}`)
} else if (options.command === "report") {
  if (!options.input) throw new Error("report requires --input <results.json>")
  const report = JSON.parse(await readFile(options.input, "utf8"))
  await save(report)
  console.log(`Report: ${path.join(options.out, report.stage === "attribution-pilot" ? "summary.md" : "index.html")}`)
} else {
  const attribution = options.command === "run-attribution"
  const profiles = options.command === "run-profiles"
  const attributionInput = { stockBinary: options.stockBin!, integratedBinary: options.patchlineBin!, originalPlugin: options.originalPlugin!, optimizedPlugin: options.optimizedPlugin! }
  const preparation = attribution ? JSON.parse(await readFile(options.input!, "utf8")) : null
  if (attribution) await verifyAttributionManifest(preparation, attributionInput)
  const report: Json = { schemaVersion: 1, stage: options.command === "check" ? "offline-check" : options.stage, createdAt: new Date().toISOString(), model: options.model ?? "not selected (offline)", variant: options.variant ?? null, environment: {}, limits: { maxSessions: options.maxSessions, steps: options.steps, timeoutMs: options.timeoutMs }, runs: [], local: [], notes: ["Сравнение полной интеграции: host tool-selection и plugin precision. Основные выводы относятся к интеграции целиком.", "Время включает загрузку процесса и обмен с провайдером; проверочные тесты выполняются после замера.", "Схемы инструментов и системная политика отличаются как часть вмешательства. Кеш провайдера не контролируется."] }
  report.toolProfile = options.toolProfile
  if (profiles) {
    report.stage = "profile-diagnostic"
    report.execution = { authorizedSessions: 12, acceptance: "not-established-pilot" }
    report.notes = ["Current plugin/host extended versus compact; descriptive diagnostic only.", "Token accounting; provider cache uncontrolled."]
    if (!options.patchlineBin) throw new Error("run-profiles requires --patchline-bin")
    options.stockBin = options.patchlineBin
  }
  report.environment.corpusSha256 = createHash("sha256").update(JSON.stringify(comparisonTasks)).digest("hex")
  report.environment.sourceTree = await fingerprintTree(path.join(repository, "src"))
  report.environment.benchmarkTree = await fingerprintTree(path.join(repository, "benchmarks", "comparison"))
  report.toolProfiles = await measureToolProfiles(repository)
  report.local = await localChecks(tempRoot)
  if (report.local.some((check: Json) => !check.passed)) throw new Error("Local safety checks failed")
  if (options.command === "check") {
    const root = await mkdtemp(path.join(tempRoot, "patchline-golden-"))
    try {
      for (const task of comparisonTasks) {
        const workspace = path.join(root, task.id)
        await mkdir(workspace)
        await materialize(workspace, task.expected)
        const golden = await evaluateTask(task, workspace, root)
        if (!golden.functionalSuccess || !golden.preservationSuccess) throw new Error(`Golden checks failed: ${task.id}: ${JSON.stringify(golden.checks)}`)
        report.local.push({ name: `Эталон: ${task.title}`, passed: true, detail: `${golden.checks.length} поведенческих проверок` })
      }
    } finally { await rm(root, { recursive: true, force: true }) }
    await save(report)
    console.log(`Offline checks passed. Report: ${path.join(options.out, "index.html")}`)
  } else {
    const artifacts: Awaited<ReturnType<typeof fingerprintAttributionArtifacts>> = attribution ? structuredClone(preparation.artifacts) : []
    if (attribution) {
      options.model = preparation.model
      options.steps = preparation.limits.steps
      options.timeoutMs = preparation.limits.timeoutMs
      report.stage = "attribution-pilot"
      report.preparation = preparation
      report.execution = { authorizedSessions: 18, authorizedAt: new Date().toISOString() }
      report.limits = { maxSessions: 18, steps: options.steps, timeoutMs: options.timeoutMs }
      report.notes = ["Отдельный attribution-пилот: stock, original (extended), optimized (compact).", "Original и optimized используют один integrated host; stock использует отдельный host.", "Учёт ведётся по токенам. Кеш провайдера не контролируется. Пилот не доказывает acceptance.", "Время включает процесс и provider exchange, исключая setup, fingerprint verification и grading."]
    }
    if (!options.model || !options.providerConfig || !options.stockBin || !options.patchlineBin) throw new Error("run requires --model, --provider-config, --stock-bin and --patchline-bin")
    report.environment.reproducibleBuild = await verifyReproducibleBuild(repository)
    const model = options.model
    report.model = model
    const slash = model.indexOf("/")
    const providerID = model.slice(0, slash)
    const configErrors: import("jsonc-parser").ParseError[] = []
    const source = parse(await readFile(options.providerConfig, "utf8"), configErrors) as Json
    if (configErrors.length) throw new Error("Provider configuration is invalid JSON/JSONC")
    const provider = source.provider?.[providerID]
    if (!provider?.options?.baseURL || typeof provider.options.apiKey !== "string") throw new Error("This runner requires an OpenAI-compatible provider with baseURL and apiKey")
    if (provider.npm !== "@ai-sdk/openai-compatible") throw new Error("This runner currently supports @ai-sdk/openai-compatible only")
    const plugin = path.join(repository, "dist", "plugin.js")
    const profileIdentity = async () => JSON.stringify({
      source: await fingerprintTree(path.join(repository, "src")),
      distribution: await fingerprintTree(path.join(repository, "dist")),
      host: createHash("sha256").update(await readFile(options.patchlineBin!)).digest("hex"),
        lock: createHash("sha256").update(await readFile(path.join(repository, "package-lock.json"))).digest("hex"),
        settings: profileSettingsFingerprint({ model, steps: options.steps, timeoutMs: options.timeoutMs, provider }),
    })
    const profileBaseline = profiles ? await profileIdentity() : null
    let profileDispatched = 0
    if (profiles) {
      await mkdir(options.out, { recursive: true })
      if (options.input) {
        const prior = JSON.parse(await readFile(options.input, "utf8"))
        const execution = JSON.parse(await readFile(path.join(options.out, "profile-execution.json"), "utf8"))
        if (prior.stage !== "profile-diagnostic" || execution.authorizedSessions !== 12 || JSON.stringify(execution.identity) !== profileBaseline || JSON.stringify(execution.schedule) !== JSON.stringify(profileDiagnosticSchedule())) throw new Error("Profile resume identity/design mismatch")
        const dispatched = await loadProfileDispatches(options.out)
        if (!dispatched.length) throw new Error("Profile resume requires an explicit dispatch ledger")
        validateProfileResumeRuns(dispatched, prior.runs)
        await verifyProfileMeasurementArtifacts(options.out, prior.runs)
        profileDispatched = dispatched.length
        report.runs = prior.runs
        report.notes.push("Resumed from durable dispatch ledger; interrupted dispatches are not retried.")
        report.profileIdentity = execution.identity
      } else {
      await writeFile(path.join(options.out, "profile-execution.json"), JSON.stringify({ authorizedSessions: 12, schedule: profileDiagnosticSchedule(), identity: JSON.parse(profileBaseline!) }), { flag: "wx", mode: 0o600 })
      report.profileIdentity = JSON.parse(profileBaseline!)
      }
    }
    await access(plugin)
    const binaries = { stock: path.resolve(options.stockBin), patchline: path.resolve(options.patchlineBin) }
    const root = await mkdtemp(path.join(tempRoot, "patchline-ab-"))
    const secrets = [provider.options.apiKey, provider.options.baseURL]
    const clean = (text: string) => secrets.reduce((value, secret) => value.replaceAll(secret, "<redacted>"), text).replaceAll(root, "<benchmark>")
    try {
      const probe = path.join(root, "probe")
      await mkdir(probe)
      for (const mode of ["stock", "patchline"] as const) {
        const result = await runProcess(binaries[mode], ["--version"], { cwd: probe, env: isolatedEnvironment(probe), timeoutMs: 15000 })
        if (result.code !== 0) throw new Error(`Version probe failed: ${mode}`)
        report.environment[`${mode}Version`] = result.stdout.trim()
        report.environment[`${mode}Sha256`] = createHash("sha256").update(await readFile(binaries[mode])).digest("hex")
      }
      if (!profiles && /patchline/i.test(report.environment.stockVersion)) throw new Error("Stock binary contains Patchline; use an upstream binary")
      if (!profiles && report.environment.patchlineVersion.split("+")[0] !== report.environment.stockVersion) throw new Error("OpenCode upstream versions must match")
      report.environment.pluginSha256 = createHash("sha256").update(await readFile(plugin)).digest("hex")
      report.environment.node = process.version
      report.environment.platform = `${process.platform}/${process.arch}`
      report.environment.temperature = 0
      report.environment.variant = options.variant ?? "provider default"
      report.environment.gitRevision = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: repository, env: process.env, timeoutMs: 10000 })).stdout.trim()
      const sourceState = await runProcess("git", ["diff", "--binary", "HEAD", "--", "src", "package.json", "package-lock.json"], { cwd: repository, env: fixtureGitEnvironment(), timeoutMs: 10000 })
      if (sourceState.code !== 0 || sourceState.outputLimited || sourceState.timedOut) throw new Error("Cannot fingerprint source worktree")
      report.environment.sourceDiffSha256 = createHash("sha256").update(sourceState.stdout).digest("hex")
      report.environment.sourceDirty = Boolean(sourceState.stdout)
      report.environment.lockfileSha256 = createHash("sha256").update(await readFile(path.join(repository, "package-lock.json"))).digest("hex")
      report.environment.buildTree = await fingerprintTree(path.join(repository, "dist"))
      report.environment.dependencies = Object.fromEntries(await Promise.all(["typescript", "@opencode-ai/plugin", "@opencode-ai/sdk", "diff", "zod"].map(async (name) => {
        const dependency = JSON.parse(await readFile(path.join(repository, "node_modules", name, "package.json"), "utf8"))
        return [name, dependency.version]
      })))
      const tasks = attribution || profiles ? comparisonTasks.filter((task) => ["targeted", "large-file", "three-files"].includes(task.id)) : options.stage === "pilot" ? comparisonTasks.filter((task) => task.pilot) : comparisonTasks
      const repeats = attribution ? 2 : options.repeats
      const sessionCount = attribution ? 18 : tasks.length * repeats * 2
      if (options.maxSessions < sessionCount) throw new Error(`Complete ${options.stage} requires --max-sessions ${sessionCount}; refusing an incomplete paired design`)
      report.manifest = profiles ? profileDiagnosticSchedule() : attribution ? preparation.schedule : tasks.flatMap((task) => Array.from({ length: repeats }, (_, repeat) => (["stock", "patchline"] as const).map((mode) => ({ taskId: task.id, repeat, mode })))).flat()
      const schedule: { taskId: string; repeat: number; mode: Mode; treatment?: string; toolProfile?: "extended" | "compact" }[] = profiles ? profileDiagnosticSchedule().map((entry) => ({ ...entry, mode: "patchline" as const })) : attribution ? preparation.schedule.map((entry: Json) => ({ ...entry, mode: entry.treatment === "stock" ? "stock" : "patchline" })) : Array.from({ length: repeats }, (_, repeat) => tasks.flatMap((task, taskIndex) => ((taskIndex + repeat) % 2 === 0 ? ["stock", "patchline"] : ["patchline", "stock"]).map((mode) => ({ taskId: task.id, repeat, mode: mode as Mode })))).flat()
      let attributionDispatched = 0
      if (attribution) {
        report.environment.settingsFingerprint = profileSettingsFingerprint({ model, steps: options.steps, timeoutMs: options.timeoutMs, provider })
        await mkdir(options.out, { recursive: true })
        let prior: Json | undefined
        try { prior = JSON.parse(await readFile(path.join(options.out, "results.json"), "utf8")) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
        attributionDispatched = await loadAttributionDispatches(options.out, schedule)
        if (prior) {
          if (JSON.stringify(prior.preparation) !== JSON.stringify(preparation) || !Array.isArray(prior.runs) || !attributionDispatched) throw new Error("Attribution resume requires matching preparation and explicit dispatch ledger")
          validateAttributionResumeRuns(schedule, attributionDispatched, prior.runs, { saved: prior.environment?.settingsFingerprint, current: report.environment.settingsFingerprint })
          await verifyProfileMeasurementArtifacts(options.out, prior.runs)
          report.runs = prior.runs
          report.execution = prior.execution
          report.notes.push("Resumed from explicit dispatch ledger; interrupted slots remain consumed.")
        } else if (attributionDispatched) throw new Error("Attribution ledger has no matching report")
      }
      await save(report)
      for (const [index, entry] of schedule.entries()) {
        if (attribution && index < attributionDispatched) continue
        if (profiles && index < profileDispatched) continue
        if (profiles) await verifyProfileIdentity(profileBaseline!, profileIdentity)
        const { repeat, mode } = entry
        const task = tasks.find((task) => task.id === entry.taskId)!
        if (attribution) await verifyAttributionManifest(preparation, attributionInput)
        if (attribution) await reserveAttributionDispatch(options.out, schedule, index)
        const artifact = artifacts.find((artifact) => artifact.treatment === entry.treatment)
        {
          const sessionRoot = path.join(root, `${task.id}-${repeat}-${entry.toolProfile ?? entry.treatment ?? mode}`)
          const workspace = path.join(sessionRoot, "workspace")
          const home = path.join(sessionRoot, "home")
          await mkdir(workspace, { recursive: true }); await mkdir(home)
          await prepareTaskWorkspace(task, workspace)
          const indexBefore = await gitIndexFingerprint(workspace)
          if (!indexBefore) throw new Error("Cannot fingerprint initial Git index")
          const relay = await createRelay({ baseURL: provider.options.baseURL, apiKey: provider.options.apiKey, maxRequests: options.steps + 3, timeoutMs: options.timeoutMs })
          const isolatedProvider = { ...provider, options: { ...provider.options, baseURL: relay.url, apiKey: "benchmark-relay" } }
          const config = isolatedConfig({ model, provider: isolatedProvider, mode, plugin: artifact?.plugin?.path ?? plugin, steps: options.steps, toolProfile: entry.toolProfile ?? artifact?.toolProfile ?? options.toolProfile })
          const env = fixtureGitEnvironment(isolatedEnvironment(home))
          env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
          const prompt = `${task.prompt}\n\nWork only in this project. Implement the requested change using available tools. Preserve unrelated content. Do not create documentation, commit changes, or use subagents. Finish with a brief summary.`
          const args = ["run", "--format", "json", "--agent", "build", "--model", model]
          if (options.variant) args.push("--variant", options.variant)
          args.push(prompt)
          console.log(`[${index + 1}/${sessionCount}] ${mode}${entry.toolProfile ? `/${entry.toolProfile}` : ""} · ${task.id} · repeat ${repeat + 1}`)
          let result: Awaited<ReturnType<typeof runProcess>>
          try {
            if (profiles) await reserveProfileDispatch(options.out, schedule.slice(0, index) as { taskId: string; repeat: number; toolProfile: string }[], entry as { taskId: string; repeat: number; toolProfile: string })
            result = await runProcess(artifact?.binary.path ?? binaries[mode], args, { cwd: workspace, env, timeoutMs: options.timeoutMs })
          }
          finally { await relay.close() }
          const rawEvents: Json[] = []
          let invalidLines = 0
          for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) { try { rawEvents.push(JSON.parse(clean(line))) } catch { invalidLines++ } }
          const events = collectEvents(rawEvents)
          const providerCalls = relay.calls
          const usage = sumUsage(providerCalls.map((call) => call.usage))
          const errors = [...events.errors, ...(result.spawnError ? [clean(result.spawnError)] : []), ...(result.stderr ? [clean(result.stderr)] : []), ...(result.timedOut ? ["Session timeout"] : []), ...(result.outputLimited ? ["Output limit exceeded"] : [])]
          const indexAfter = await gitIndexFingerprint(workspace)
          const indexPreserved = indexBefore === indexAfter
          if (!indexPreserved) errors.push("Git staged state changed during the task")
          const executionSuccess = result.code === 0 && !result.timedOut && !result.outputLimited && !events.errors.length && indexPreserved
          const run: Json = { taskId: task.id, title: task.title, category: task.category, repeat, mode, ...(entry.toolProfile ? { toolProfile: entry.toolProfile } : {}), prompt: task.prompt, durationMs: result.durationMs, exitCode: result.code, timedOut: result.timedOut, success: false, usage, usageSource: usage ? "provider streaming usage" : "unavailable", events, providerCalls, invalidLines, evaluation: null, errors }
          run.gitIndex = { before: indexBefore, after: indexAfter, preserved: indexPreserved }
          if (attribution) run.treatment = entry.treatment
          run.measurementArtifact = await saveMeasurementArtifact(options.out, { ...run, stdout: clean(result.stdout), stderr: clean(result.stderr), outputLimited: result.outputLimited, spawnError: result.spawnError ? clean(result.spawnError) : null })
          if (profiles) await verifyProfileIdentity(profileBaseline!, profileIdentity)
          if (usage && events.usage && usage.total !== events.usage.total) report.notes.push(`Usage mismatch: ${task.id}/${mode}/${repeat}; provider=${usage.total}, OpenCode=${events.usage.total}. Provider usage includes retries.`)
          await recordMeasuredRun(report as { runs: Json[] }, run, () => save(report), () => evaluateTask(task, workspace, sessionRoot), executionSuccess)
          console.log(`  ${run.success ? "PASS" : "FAIL"} · ${(result.durationMs / 1000).toFixed(1)}s · ${usage?.total ?? "unknown"} tokens · ${events.tools.length} tools`)
          await rm(sessionRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
          if (attribution) await verifyAttributionManifest(preparation, attributionInput)
        }
      }
      report.completedAt = new Date().toISOString()
      await save(report)
      console.log(`Report: ${path.join(options.out, "index.html")}`)
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
  }
}
