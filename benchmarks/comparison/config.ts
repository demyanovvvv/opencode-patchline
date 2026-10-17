import path from "node:path"
import { readFile, realpath, stat, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import type { Json, Mode } from "./metrics.js"
import { comparisonTasks } from "./tasks.js"
import { fingerprintTree } from "./process.js"

export async function saveAttributionManifest(filename: string, input: Parameters<typeof attributionTreatments>[0], expected: Awaited<ReturnType<typeof fingerprintAttributionArtifacts>>) {
  const artifacts = await fingerprintAttributionArtifacts(input)
  if (JSON.stringify(artifacts) !== JSON.stringify(expected)) throw new Error("Attribution artifacts changed before manifest persistence")
  const output = path.join(await realpath(path.dirname(path.resolve(filename))), path.basename(filename))
  for (const artifact of artifacts) {
    if (!artifact.plugin) continue
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
    artifacts, schedule: attributionSchedule(),
  }
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  return manifest
}

export async function verifyAttributionManifest(manifest: Awaited<ReturnType<typeof saveAttributionManifest>>, input: Parameters<typeof attributionTreatments>[0]) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.schemaVersion !== 1 || manifest.stage !== "attribution-pilot" || manifest.executionAuthorized !== false
    || manifest.model !== "omniroute/vilao/gpt-6.1-sol" || manifest.temperature !== 0
    || JSON.stringify(manifest.limits) !== JSON.stringify({ sessions: 18, steps: 8, timeoutMs: 180000 })
    || manifest.cacheControl !== "uncontrolled-provider-cache"
    || manifest.corpusSha256 !== createHash("sha256").update(JSON.stringify(comparisonTasks)).digest("hex")
    || JSON.stringify(manifest.schedule) !== JSON.stringify(attributionSchedule())) throw new Error("Attribution preparation design changed or is invalid")
  const current = await fingerprintAttributionArtifacts(input)
  if (JSON.stringify(current) !== JSON.stringify(manifest.artifacts)) throw new Error("Attribution artifacts changed since preparation")
}

export async function fingerprintAttributionArtifacts(input: Parameters<typeof attributionTreatments>[0]) {
  const fingerprint = async (filename: string) => {
    const canonicalPath = await realpath(filename)
    if (!(await stat(canonicalPath)).isFile()) throw new Error(`Attribution artifact is not a file: ${canonicalPath}`)
    const bytes = await readFile(canonicalPath)
    return { path: canonicalPath, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
  }
  const artifacts = await Promise.all(attributionTreatments(input).map(async (entry) => ({
    ...entry, binary: await fingerprint(entry.binary), plugin: entry.plugin ? await fingerprint(entry.plugin) : null,
    distribution: entry.plugin ? await fingerprintTree(path.dirname(await realpath(entry.plugin))) : null,
  })))
  if (artifacts[1]!.plugin!.sha256 === artifacts[2]!.plugin!.sha256) throw new Error("Attribution cannot compare identical plugin contents")
  return artifacts
}

export function attributionTreatments(input: { stockBinary: string; integratedBinary: string; originalPlugin: string; optimizedPlugin: string }) {
  if (Object.values(input).some((value) => !value.trim())) throw new Error("Attribution requires explicit host and plugin paths")
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

export function parseOptions(args: string[]) {
  const command = args[0] ?? "check"
  if (!["check", "run", "report", "prepare-attribution"].includes(command)) throw new Error("Commands: check, run, report, prepare-attribution")
  const values: Record<string, string> = {}
  const allowed = new Set(["stage", "model", "provider-config", "stock-bin", "patchline-bin", "max-sessions", "timeout", "steps", "out", "input", "temp-root", "variant", "tool-profile", "repeats", "original-plugin", "optimized-plugin"])
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "")
    const value = args[index + 1]
    if (!key || !allowed.has(key) || !value || value.startsWith("--") || values[key]) throw new Error(`Invalid option: ${args[index]}`)
    values[key] = value
  }
  if (command !== "prepare-attribution" && (values["original-plugin"] || values["optimized-plugin"])) throw new Error("Plugin artifact overrides are only supported by prepare-attribution")
  if (command === "prepare-attribution" && ["model", "steps", "timeout", "max-sessions", "repeats", "variant", "tool-profile", "stage"].some((key) => values[key] !== undefined)) {
    throw new Error("Attribution preparation uses a fixed design; model/limit/profile overrides are not supported")
  }
  const stage = values.stage ?? "pilot"
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
