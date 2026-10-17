import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "jsonc-parser"
import { fingerprintAttributionArtifacts, saveAttributionManifest, isolatedConfig, isolatedEnvironment, parseOptions } from "./config.js"
import { evaluateTask, materialize, prepareTaskWorkspace, recordMeasuredRun, saveMeasurementArtifact } from "./evaluate.js"
import { localChecks, measureToolProfiles } from "./local.js"
import { collectEvents, sumUsage, type Json, type Mode } from "./metrics.js"
import { fingerprintTree, fixtureGitEnvironment, gitIndexFingerprint, runProcess, verifyReproducibleBuild } from "./process.js"
import { createRelay } from "./relay.js"
import { markdownReport, renderReport } from "./report.js"
import { comparisonTasks } from "./tasks.js"
import { experimentSummary, validateManifest } from "./analysis.js"

const repository = fileURLToPath(new URL("../../", import.meta.url))
const options = parseOptions(process.argv.slice(2))
const tempRoot = options.tempRoot ?? os.tmpdir()
await access(tempRoot)

async function save(report: Json) {
  report.integrity = validateManifest(report.manifest, report.runs)
  report.analysis = experimentSummary(report.runs.map((run: Json) => ({ taskId: run.taskId, repeat: run.repeat, mode: run.mode, durationMs: run.durationMs, tokens: run.usage?.total ?? null, success: run.success })), comparisonTasks.length * 2 * 5)
  await mkdir(options.out, { recursive: true })
  await writeFile(path.join(options.out, "results.json"), JSON.stringify(report, null, 2) + "\n")
  await writeFile(path.join(options.out, "index.html"), renderReport(report))
  await writeFile(path.join(options.out, "summary.md"), markdownReport(report))
  const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`
  await writeFile(path.join(options.out, "results.csv"), ["task,repeat,mode,success,duration_ms,tokens,input,output,reasoning,cache_read,cache_write,precision,tool_calls,tool_errors", ...report.runs.map((r: Json) => [r.taskId, r.repeat + 1, r.mode, r.success, r.durationMs, r.usage?.total, r.usage?.input, r.usage?.output, r.usage?.reasoning, r.usage?.cacheRead, r.usage?.cacheWrite, r.evaluation?.comparison.precision, r.events.tools.length, r.events.toolErrors].map(csv).join(","))].join("\n") + "\n")
}

if (options.command === "prepare-attribution") {
  const input = { stockBinary: options.stockBin ?? "", integratedBinary: options.patchlineBin ?? "", originalPlugin: options.originalPlugin ?? "", optimizedPlugin: options.optimizedPlugin ?? "" }
  const artifacts = await fingerprintAttributionArtifacts(input)
  await mkdir(options.out, { recursive: true })
  await saveAttributionManifest(path.join(options.out, "attribution-manifest.json"), input, artifacts)
  console.log(`Preparation only: ${path.join(options.out, "attribution-manifest.json")}`)
} else if (options.command === "report") {
  if (!options.input) throw new Error("report requires --input <results.json>")
  await save(JSON.parse(await readFile(options.input, "utf8")))
  console.log(`Report: ${path.join(options.out, "index.html")}`)
} else {
  const report: Json = { schemaVersion: 1, stage: options.command === "check" ? "offline-check" : options.stage, createdAt: new Date().toISOString(), model: options.model ?? "not selected (offline)", variant: options.variant ?? null, environment: {}, limits: { maxSessions: options.maxSessions, steps: options.steps, timeoutMs: options.timeoutMs }, runs: [], local: [], notes: ["Сравнение полной интеграции: host tool-selection и plugin precision. Основные выводы относятся к интеграции целиком.", "Время включает загрузку процесса и обмен с провайдером; проверочные тесты выполняются после замера.", "Схемы инструментов и системная политика отличаются как часть вмешательства. Кеш провайдера не контролируется.", "Тарифы модели не заданы; нулевая стоимость в OpenCode не интерпретируется как бесплатность."] }
  report.toolProfile = options.toolProfile
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
      if (/patchline/i.test(report.environment.stockVersion)) throw new Error("Stock binary contains Patchline; use an upstream binary")
      if (report.environment.patchlineVersion.split("+")[0] !== report.environment.stockVersion) throw new Error("OpenCode upstream versions must match")
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
      const tasks = options.stage === "pilot" ? comparisonTasks.filter((task) => task.pilot) : comparisonTasks
      const repeats = options.repeats
      const sessionCount = tasks.length * repeats * 2
      if (options.maxSessions < sessionCount) throw new Error(`Complete ${options.stage} requires --max-sessions ${sessionCount}; refusing an incomplete paired design`)
      report.manifest = tasks.flatMap((task) => Array.from({ length: repeats }, (_, repeat) => (["stock", "patchline"] as const).map((mode) => ({ taskId: task.id, repeat, mode })))).flat()
      await save(report)
      for (let repeat = 0; repeat < repeats; repeat++) for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex]!
        const order: Mode[] = (taskIndex + repeat) % 2 === 0 ? ["stock", "patchline"] : ["patchline", "stock"]
        for (const mode of order) {
          const sessionRoot = path.join(root, `${task.id}-${repeat}-${mode}`)
          const workspace = path.join(sessionRoot, "workspace")
          const home = path.join(sessionRoot, "home")
          await mkdir(workspace, { recursive: true }); await mkdir(home)
          await prepareTaskWorkspace(task, workspace)
          const indexBefore = await gitIndexFingerprint(workspace)
          if (!indexBefore) throw new Error("Cannot fingerprint initial Git index")
          const relay = await createRelay({ baseURL: provider.options.baseURL, apiKey: provider.options.apiKey, maxRequests: options.steps + 3, timeoutMs: options.timeoutMs })
          const isolatedProvider = { ...provider, options: { ...provider.options, baseURL: relay.url, apiKey: "benchmark-relay" } }
          const config = isolatedConfig({ model, provider: isolatedProvider, mode, plugin, steps: options.steps, toolProfile: options.toolProfile })
          const env = fixtureGitEnvironment(isolatedEnvironment(home))
          env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
          const prompt = `${task.prompt}\n\nWork only in this project. Implement the requested change using available tools. Preserve unrelated content. Do not create documentation, commit changes, or use subagents. Finish with a brief summary.`
          const args = ["run", "--format", "json", "--agent", "build", "--model", model]
          if (options.variant) args.push("--variant", options.variant)
          args.push(prompt)
          console.log(`[${report.runs.length + 1}/${sessionCount}] ${mode} · ${task.id} · repeat ${repeat + 1}`)
          let result: Awaited<ReturnType<typeof runProcess>>
          try { result = await runProcess(binaries[mode], args, { cwd: workspace, env, timeoutMs: options.timeoutMs }) }
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
          const run: Json = { taskId: task.id, title: task.title, category: task.category, repeat, mode, prompt: task.prompt, durationMs: result.durationMs, exitCode: result.code, timedOut: result.timedOut, success: false, usage, usageSource: usage ? "provider streaming usage" : "unavailable", events, providerCalls, invalidLines, evaluation: null, errors }
          run.gitIndex = { before: indexBefore, after: indexAfter, preserved: indexPreserved }
          run.measurementArtifact = await saveMeasurementArtifact(options.out, { ...run, stdout: clean(result.stdout), stderr: clean(result.stderr), outputLimited: result.outputLimited, spawnError: result.spawnError ? clean(result.spawnError) : null })
          if (usage && events.usage && usage.total !== events.usage.total) report.notes.push(`Usage mismatch: ${task.id}/${mode}/${repeat}; provider=${usage.total}, OpenCode=${events.usage.total}. Provider usage includes retries.`)
          await recordMeasuredRun(report as { runs: Json[] }, run, () => save(report), () => evaluateTask(task, workspace, sessionRoot), executionSuccess)
          console.log(`  ${run.success ? "PASS" : "FAIL"} · ${(result.durationMs / 1000).toFixed(1)}s · ${usage?.total ?? "unknown"} tokens · ${events.tools.length} tools`)
          await rm(sessionRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        }
      }
      report.completedAt = new Date().toISOString()
      await save(report)
      console.log(`Report: ${path.join(options.out, "index.html")}`)
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
  }
}
