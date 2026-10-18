import path from "node:path"
import { open, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import type { Json, Mode } from "./metrics.js"
import { comparisonTasks } from "./tasks.js"
import { fingerprintTree } from "./process.js"

export async function reserveAttributionDispatch(directory: string, schedule: unknown[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= schedule.length) throw new Error("Invalid attribution dispatch index")
  if (await loadAttributionDispatches(directory, schedule) !== index) throw new Error("Attribution dispatch order mismatch")
  const handle = await open(path.join(directory, `attribution-dispatch-${String(index + 1).padStart(2, "0")}.json`), "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify({ index, entry: schedule[index] }) + "\n")
    await handle.sync()
  } finally { await handle.close() }
}

export function validateAttributionResumeRuns(schedule: Json[], dispatched: number, runs: unknown, settings?: { saved: unknown; current: string }) {
  if (settings && (typeof settings.saved !== "string" || settings.saved !== settings.current)) throw new Error("Attribution execution settings changed since dispatch")
  if (!Array.isArray(runs) || !Number.isInteger(dispatched) || dispatched < 0 || dispatched > schedule.length) throw new Error("Invalid attribution resume measurements")
  const seen = new Set<number>()
  for (const run of runs) {
    if (!run || typeof run !== "object") throw new Error("Invalid attribution resume measurement")
    const slot = schedule.findIndex((entry) => entry.taskId === run.taskId && entry.repeat === run.repeat && entry.treatment === run.treatment && entry.mode === run.mode)
    if (slot < 0 || slot >= dispatched || seen.has(slot) || run.gradingStatus !== "complete" || typeof run.success !== "boolean") throw new Error("Invalid attribution resume measurement")
    seen.add(slot)
  }
}

export async function loadAttributionDispatches(directory: string, schedule: unknown[]) {
  const files = (await readdir(directory)).filter((name) => /^attribution-dispatch-.*\.json$/.test(name)).sort()
  for (let index = 0; index < files.length; index++) {
    if (files[index] !== `attribution-dispatch-${String(index + 1).padStart(2, "0")}.json`) throw new Error("Attribution dispatch gap")
    const record = JSON.parse(await readFile(path.join(directory, files[index]!), "utf8"))
    if (index >= schedule.length || record.index !== index || JSON.stringify(record.entry) !== JSON.stringify(schedule[index])) throw new Error("Attribution dispatch identity mismatch")
  }
  return files.length
}

export async function saveAttributionManifest(filename: string, input: Parameters<typeof attributionTreatments>[0], expected: Awaited<ReturnType<typeof fingerprintAttributionArtifacts>>) {
  const artifacts = await fingerprintAttributionArtifacts(input)
  if (JSON.stringify(artifacts) !== JSON.stringify(expected)) throw new Error("Attribution artifacts changed before manifest persistence")
  const output = path.join(await realpath(path.dirname(path.resolve(filename))), path.basename(filename))
  for (const artifact of artifacts) {
    if (!artifact.plugin) continue
    if (artifact.dependencies) {
      const dependencyRelative = path.relative(artifact.dependencies.path, output)
      if (dependencyRelative === "" || (!dependencyRelative.startsWith(`..${path.sep}`) && dependencyRelative !== ".." && !path.isAbsolute(dependencyRelative))) {
        throw new Error("Cannot save attribution output inside a measured dependency installation")
      }
    }
    const relative = path.relative(path.dirname(artifact.plugin.path), output)
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("Cannot save attribution output inside a measured distribution")
    }
  }
  const manifest = {
    schemaVersion: 1, stage: "attribution-pilot", executionAuthorized: false,
    model: "omniroute/vilao/gpt-6.1-sol", temperature: 0,
    limits: { sessions: 18, steps: 8, timeoutMs: 180000 },
    cacheControl: "uncontrolled-provider-cache",
    corpusSha256: createHash("sha256").update(JSON.stringify(comparisonTasks)).digest("hex"),
    harnessTree: await fingerprintTree(fileURLToPath(new URL("./", import.meta.url))),
    sourceTree: await fingerprintTree(fileURLToPath(new URL("../../src/", import.meta.url))),
    lockfileSha256: createHash("sha256").update(await readFile(new URL("../../package-lock.json", import.meta.url))).digest("hex"),
    artifacts, schedule: attributionSchedule(),
  }
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  return manifest
}

export async function dispatchAttributionSchedule<T>(
  manifest: Awaited<ReturnType<typeof saveAttributionManifest>>,
  input: Parameters<typeof attributionTreatments>[0],
  dispatch: (entry: ReturnType<typeof attributionSchedule>[number], artifact: Awaited<ReturnType<typeof fingerprintAttributionArtifacts>>[number]) => Promise<T>,
  checkpoint?: (results: readonly T[]) => Promise<void>,
  signal?: AbortSignal,
) {
  const results: T[] = []
  for (const entry of attributionSchedule()) {
    signal?.throwIfAborted()
    await verifyAttributionManifest(manifest, input)
    signal?.throwIfAborted()
    const artifact = manifest.artifacts.find((candidate) => candidate.treatment === entry.treatment)!
    const result = await dispatch(entry, structuredClone(artifact))
    await verifyAttributionManifest(manifest, input)
    results.push(result)
    await checkpoint?.([...results])
    signal?.throwIfAborted()
  }
  return results
}

export async function verifyAttributionManifest(manifest: Awaited<ReturnType<typeof saveAttributionManifest>>, input: Parameters<typeof attributionTreatments>[0]) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.schemaVersion !== 1 || manifest.stage !== "attribution-pilot" || manifest.executionAuthorized !== false
    || manifest.model !== "omniroute/vilao/gpt-6.1-sol" || manifest.temperature !== 0
    || JSON.stringify(manifest.limits) !== JSON.stringify({ sessions: 18, steps: 8, timeoutMs: 180000 })
    || manifest.cacheControl !== "uncontrolled-provider-cache"
    || manifest.corpusSha256 !== createHash("sha256").update(JSON.stringify(comparisonTasks)).digest("hex")
    || JSON.stringify(manifest.schedule) !== JSON.stringify(attributionSchedule())) throw new Error("Attribution preparation design changed or is invalid")
  const current = await fingerprintAttributionArtifacts(input)
  const harnessTree = await fingerprintTree(fileURLToPath(new URL("./", import.meta.url)))
  if (JSON.stringify(harnessTree) !== JSON.stringify(manifest.harnessTree)) throw new Error("Attribution harness changed since preparation")
  const sourceTree = await fingerprintTree(fileURLToPath(new URL("../../src/", import.meta.url)))
  if (JSON.stringify(sourceTree) !== JSON.stringify(manifest.sourceTree)) throw new Error("Attribution source changed since preparation")
  const lockfileSha256 = createHash("sha256").update(await readFile(new URL("../../package-lock.json", import.meta.url))).digest("hex")
  if (lockfileSha256 !== manifest.lockfileSha256) throw new Error("Attribution lockfile changed since preparation")
  if (JSON.stringify(current) !== JSON.stringify(manifest.artifacts)) throw new Error("Attribution artifacts changed since preparation")
}

export async function fingerprintAttributionArtifacts(input: Parameters<typeof attributionTreatments>[0]) {
  const dependencies = async (plugin: string) => {
    const directory = path.resolve(path.dirname(await realpath(plugin)), "..", "node_modules")
    try {
      await stat(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
    return { path: await realpath(directory), ...await fingerprintTree(directory) }
  }
  const fingerprint = async (filename: string) => {
    const canonicalPath = await realpath(filename)
    if (!(await stat(canonicalPath)).isFile()) throw new Error(`Attribution artifact is not a file: ${canonicalPath}`)
    const bytes = await readFile(canonicalPath)
    return { path: canonicalPath, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
  }
  const artifacts = await Promise.all(attributionTreatments(input).map(async (entry) => ({
    ...entry, binary: await fingerprint(entry.binary), plugin: entry.plugin ? await fingerprint(entry.plugin) : null,
    distribution: entry.plugin ? await fingerprintTree(path.dirname(await realpath(entry.plugin))) : null,
    dependencies: entry.plugin ? await dependencies(entry.plugin) : null,
  })))
  if (artifacts[1]!.plugin!.sha256 === artifacts[2]!.plugin!.sha256) throw new Error("Attribution cannot compare identical plugin contents")
  return artifacts
}

export function attributionTreatments(input: { stockBinary: string; integratedBinary: string; originalPlugin: string; optimizedPlugin: string }) {
  if ([input.stockBinary, input.integratedBinary, input.originalPlugin, input.optimizedPlugin].some((value) => typeof value !== "string" || !value.trim())) throw new Error("Attribution requires explicit host and plugin paths")
  const originalPlugin = path.resolve(input.originalPlugin)
  const optimizedPlugin = path.resolve(input.optimizedPlugin)
  const identity = (value: string) => process.platform === "win32" ? value.toLowerCase() : value
  if (identity(originalPlugin) === identity(optimizedPlugin)) throw new Error("Attribution requires distinct original and optimized plugin paths")
  const binary = path.resolve(input.integratedBinary)
  return [
    { treatment: "stock", mode: "stock", binary: path.resolve(input.stockBinary), plugin: null, toolProfile: null },
    { treatment: "original", mode: "patchline", binary, plugin: originalPlugin, toolProfile: "extended" },
    { treatment: "optimized", mode: "patchline", binary, plugin: optimizedPlugin, toolProfile: "compact" },
  ] as const
}

/** Separate attribution design; never pass these treatment IDs to paired two-mode analysis. */
export function profileDiagnosticSchedule(): { taskId: string; repeat: number; toolProfile: "extended" | "compact" }[] {
  const tasks = ["targeted", "large-file", "three-files"]
  return [0, 1].flatMap((repeat) => (repeat === 0 ? tasks : [...tasks].reverse()).flatMap((taskId) =>
    (repeat === 0 ? ["extended", "compact"] as const : ["compact", "extended"] as const).map((toolProfile) => ({ taskId, repeat, toolProfile }))))
}

/** Separate attribution design; never pass these treatment IDs to paired two-mode analysis. */
export function attributionSchedule(): { taskId: string; repeat: number; treatment: "stock" | "original" | "optimized" }[] {
  const tasks = ["targeted", "large-file", "three-files"]
  const treatments = ["stock", "original", "optimized"] as const
  return [0, 1].flatMap((repeat) => (repeat === 0 ? tasks : [...tasks].reverse()).flatMap((taskId) =>
    (repeat === 0 ? [...treatments] : [...treatments].reverse()).map((treatment) => ({ taskId, repeat, treatment }))))
}

export function isolatedEnvironment(root: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^(OPENCODE_|OTEL_)/i.test(key))),
    HOME: root, USERPROFILE: root, OPENCODE_TEST_HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
    OPENCODE_CONFIG_DIR: path.join(root, "config", "opencode"), OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOCOMPACT: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  }
}

export function isolatedConfig(input: { model: string; provider: Json; mode: Mode; plugin: string; steps: number; toolProfile?: "extended" | "compact" }) {
  const slash = input.model.indexOf("/")
  if (slash < 1) throw new Error("Use provider/model for --model")
  const providerID = input.model.slice(0, slash)
  const modelID = input.model.slice(slash + 1)
  if (!input.provider.models?.[modelID]) throw new Error(`Model not found in provider config: ${input.model}`)
  return {
    $schema: "https://opencode.ai/config.json", model: input.model, small_model: input.model, default_agent: "build",
    share: "disabled", autoupdate: false, snapshot: false, formatter: false, lsp: false,
    plugin: input.mode === "stock" ? [] : [[input.plugin, { mode: "precision", toolProfile: input.toolProfile ?? "extended", telemetry: false, lspAutoSetup: false, lspAutoInstall: false }]],
    enabled_providers: [providerID], provider: { [providerID]: { ...input.provider, models: { [modelID]: input.provider.models[modelID] } } },
    mcp: {}, instructions: [],
    permission: { "*": "allow", task: "deny", question: "deny", webfetch: "deny", websearch: "deny", external_directory: "deny" },
    agent: { build: { steps: input.steps, temperature: 0 }, title: { disable: true }, summary: { disable: true }, explore: { disable: true }, general: { disable: true } },
  }
}

export function profileSettingsFingerprint(settings: { model: string; steps: number; timeoutMs: number; provider: Json }) {
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex")
}

export async function verifyProfileMeasurementArtifacts(directory: string, runs: Json[]) {
  for (const run of runs) {
    const artifact = run.measurementArtifact
    if (!artifact || typeof artifact.file !== "string" || !/^attempt-[a-zA-Z0-9-]+\.json$/.test(artifact.file)) throw new Error("Invalid profile measurement artifact")
    const bytes = await readFile(path.join(directory, artifact.file))
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("Profile measurement artifact digest mismatch")
    const measurement = JSON.parse(bytes.toString("utf8"))
    if (!measurement || ["taskId", "repeat", "toolProfile", "mode"].some((key) => measurement[key] !== run[key])) throw new Error("Profile measurement artifact identity mismatch")
    if (!Array.isArray(measurement.errors) || !Array.isArray(run.errors) || measurement.errors.some((error: unknown, index: number) => JSON.stringify(error) !== JSON.stringify(run.errors[index]))) throw new Error("Profile measurement artifact errors mismatch")
    for (const key of new Set([...Object.keys(measurement), ...Object.keys(run)])) {
      if (["measurementArtifact", "success", "evaluation", "gradingStatus", "errors", "stdout", "stderr", "outputLimited", "spawnError"].includes(key)) continue
      if (JSON.stringify(measurement[key]) !== JSON.stringify(run[key])) throw new Error(`Profile measurement artifact field mismatch: ${key}`)
    }
  }
}

export function validateProfileResumeRuns(dispatched: { taskId: string; repeat: number; toolProfile: string }[], runs: unknown) {
  if (!Array.isArray(runs)) throw new Error("Invalid profile resume results")
  const key = (entry: { taskId: string; repeat: number; toolProfile: string }) => JSON.stringify([entry.taskId, entry.repeat, entry.toolProfile])
  const keys = new Set(dispatched.map(key))
  const seen = new Set<string>()
  for (const run of runs) {
    const artifact = run?.measurementArtifact
    if (run?.mode !== "patchline") throw new Error("Profile resume results require patchline mode")
    if (!run || typeof run !== "object" || !keys.has(key(run)) || seen.has(key(run)) || run.gradingStatus !== "complete" || typeof run.success !== "boolean" || !artifact || typeof artifact.file !== "string" || !/^attempt-[a-zA-Z0-9-]+\.json$/.test(artifact.file) || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("Profile resume results do not match dispatch ledger")
    seen.add(key(run))
  }
}

export async function reserveProfileDispatch(directory: string, dispatched: { taskId: string; repeat: number; toolProfile: string }[], entry: { taskId: string; repeat: number; toolProfile: string }) {
  remainingProfileSchedule([...dispatched, entry])
  const file = await open(path.join(directory, `profile-dispatch-${String(dispatched.length).padStart(2, "0")}.json`), "wx", 0o600)
  try {
    await file.writeFile(JSON.stringify({ index: dispatched.length, entry, state: "dispatched", timestamp: new Date().toISOString() }) + "\n")
    await file.sync()
  } finally { await file.close() }
}

export async function verifyProfileIdentity(expected: string, current: () => Promise<string>) {
  if (await current() !== expected) throw new Error("Profile diagnostic artifacts changed")
}

export async function loadProfileDispatches(directory: string) {
  const names = (await readdir(directory)).filter((name) => name.startsWith("profile-dispatch-")).sort()
  const entries: { taskId: string; repeat: number; toolProfile: string }[] = []
  for (const [index, name] of names.entries()) {
    if (name !== `profile-dispatch-${String(index).padStart(2, "0")}.json`) throw new Error("Invalid profile dispatch ledger sequence")
    const record = JSON.parse(await readFile(path.join(directory, name), "utf8"))
    if (record.index !== index || record.state !== "dispatched" || !record.entry || typeof record.timestamp !== "string" || !Number.isFinite(Date.parse(record.timestamp))) throw new Error("Invalid profile dispatch ledger record")
    entries.push(record.entry)
  }
  remainingProfileSchedule(entries)
  return entries
}

export function remainingProfileSchedule(dispatched: { taskId: string; repeat: number; toolProfile: string }[]) {
  const schedule = profileDiagnosticSchedule()
  const key = (entry: { taskId: string; repeat: number; toolProfile: string }) => JSON.stringify([entry.taskId, entry.repeat, entry.toolProfile])
  if (dispatched.length > schedule.length || dispatched.some((entry, index) => key(entry) !== key(schedule[index]!))) {
    throw new Error("Profile dispatch ledger must be an exact schedule prefix")
  }
  return schedule.slice(dispatched.length)
}

export function parseOptions(args: string[]) {
  const command = args[0] ?? "check"
  if (!["check", "run", "run-profiles", "run-attribution", "report", "prepare-attribution", "verify-attribution"].includes(command)) throw new Error("Commands: check, run, run-attribution, report, prepare-attribution, verify-attribution")
  const values: Record<string, string> = {}
  const allowed = new Set(["stage", "model", "provider-config", "stock-bin", "patchline-bin", "max-sessions", "timeout", "steps", "out", "input", "temp-root", "variant", "tool-profile", "repeats", "original-plugin", "optimized-plugin"])
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "")
    const value = args[index + 1]
    if (!key || !allowed.has(key) || !value || value.startsWith("--") || values[key]) throw new Error(`Invalid option: ${args[index]}`)
    values[key] = value
  }
  if (!["prepare-attribution", "verify-attribution", "run-attribution"].includes(command) && (values["original-plugin"] || values["optimized-plugin"])) throw new Error("Plugin artifact overrides are only supported by prepare-attribution, verify-attribution or run-attribution")
  if (command === "run-attribution" && (!values.input || values["max-sessions"] !== "18")) throw new Error("run-attribution requires --input and explicit --max-sessions 18 authorization")
  if (["prepare-attribution", "verify-attribution", "run-attribution"].includes(command) && ["model", "steps", "timeout", ...(command === "run-attribution" ? [] : ["max-sessions"]), "repeats", "variant", "tool-profile", "stage"].some((key) => values[key] !== undefined)) {
    throw new Error("Attribution preparation uses a fixed design; model/limit/profile overrides are not supported")
  }
  const stage = values.stage ?? "pilot"
  if (command === "run-profiles") {
    if (values.input && path.resolve(values.input) !== path.join(path.resolve(values.out ?? "benchmarks/reports/comparison"), "results.json")) throw new Error("Profile resume input must be the output directory results.json")
    if (values.input) values.input = path.resolve(values.input)
    if (values["max-sessions"] !== "12") throw new Error("run-profiles requires explicit --max-sessions 12 authorization")
    if (["stage", "model", "repeats", "steps", "timeout", "tool-profile", "variant"].some((key) => values[key] !== undefined)) throw new Error("Profile diagnostics use a fixed design")
    values.model = "omniroute/vilao/gpt-6.1-sol"
    values.repeats = "2"
    values.steps = "8"
    values.timeout = "180"
  }
  if (!["pilot", "full"].includes(stage)) throw new Error("--stage must be pilot or full")
  if (command === "run" && !values["max-sessions"]) throw new Error("Live runs require --max-sessions (pilot: 6; full: current task count × 10)")
  const toolProfile = values["tool-profile"] ?? "extended"
  if (toolProfile !== "extended" && toolProfile !== "compact") throw new Error("--tool-profile must be extended or compact")
  const number = (key: string, fallback: number, max: number) => {
    const value = Number(values[key] ?? fallback)
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid --${key}`)
    return value
  }
  const repeats = number("repeats", stage === "full" ? 5 : 1, 5)
  if (command === "run" && stage === "full" && repeats !== 5) throw new Error("Full runs require 5 repeats per task and mode")
  return { command, stage, toolProfile: toolProfile as "extended" | "compact", model: values.model, providerConfig: values["provider-config"], stockBin: values["stock-bin"], patchlineBin: values["patchline-bin"], originalPlugin: values["original-plugin"], optimizedPlugin: values["optimized-plugin"],
    repeats,
    maxSessions: number("max-sessions", 6, 130), timeoutMs: number("timeout", 180, 600) * 1000, steps: number("steps", 16, 50),
    out: path.resolve(values.out ?? "benchmarks/reports/comparison"), input: values.input, tempRoot: values["temp-root"], variant: values.variant }
}
