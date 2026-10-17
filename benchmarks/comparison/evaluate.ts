import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { compareFiles, type Json } from "./metrics.js"
import type { ComparisonTask } from "./tasks.js"
import { initializeFixtureRepository, runProcess } from "./process.js"

export async function prepareTaskWorkspace(task: ComparisonTask, workspace: string) {
  await materialize(workspace, task.gitBaseline ?? task.before)
  await initializeFixtureRepository(workspace)
  if (task.gitBaseline) await materialize(workspace, task.before)
}

export async function saveMeasurementArtifact(output: string, measurement: Json) {
  const file = `attempt-${randomUUID()}.json`
  const bytes = JSON.stringify(measurement, null, 2) + "\n"
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, file), bytes, { flag: "wx" })
  return { file, sha256: createHash("sha256").update(bytes).digest("hex") }
}

export async function recordMeasuredRun(report: { runs: Json[] }, run: Json, persist: () => Promise<void>, grade: () => Promise<Awaited<ReturnType<typeof evaluateTask>>>, executionSuccess: boolean) {
  run.gradingStatus = "pending"
  run.success = false
  run.evaluation = null
  report.runs.push(run)
  await persist()
  try {
    run.evaluation = await grade()
    run.gradingStatus = "complete"
    run.success = executionSuccess && run.evaluation.functionalSuccess && run.evaluation.preservationSuccess
  } catch (error) {
    run.gradingStatus = "error"
    run.errors.push(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  await persist()
}
export async function materialize(root: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.resolve(root, file)
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("Fixture escaped workspace")
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

async function contents(root: string, directory = "", result: Record<string, string> = {}, invalidEncoding: string[] = [], budget = { entries: 0, bytes: 0 }) {
  if (directory.split("/").length > 32) throw new Error("Evaluation directory depth exceeded")
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (!directory && entry.name === ".git") continue
    if (++budget.entries > 500) throw new Error("Evaluation file budget exceeded")
    const relative = path.posix.join(directory, entry.name)
    if (entry.isSymbolicLink()) { result[relative] = "[unexpected symbolic link]"; continue }
    if (entry.isDirectory()) await contents(root, relative, result, invalidEncoding, budget)
    else {
      if (!entry.isFile()) throw new Error("Evaluation encountered a non-regular file")
      const handle = await open(path.join(root, relative), "r")
      let bytes: Buffer
      try {
        const stat = await handle.stat()
        if (!stat.isFile()) throw new Error("Evaluation encountered a non-regular file")
        if (stat.size > 2_000_000 || budget.bytes + stat.size > 8_000_000) throw new Error("Evaluation file byte budget exceeded")
        const buffer = Buffer.alloc(Math.min(2_000_001, 8_000_001 - budget.bytes))
        let length = 0
        while (length < buffer.length) {
          const chunk = await handle.read(buffer, length, buffer.length - length, null)
          if (!chunk.bytesRead) break
          length += chunk.bytesRead
        }
        if (length > 2_000_000 || budget.bytes + length > 8_000_000) throw new Error("Evaluation file byte budget exceeded")
        budget.bytes += length
        bytes = buffer.subarray(0, length)
      } finally { await handle.close() }
      result[relative] = bytes.toString("utf8")
      if (!Buffer.from(result[relative], "utf8").equals(bytes)) invalidEncoding.push(relative)
    }
  }
  return result
}

export async function evaluateTask(task: ComparisonTask, workspace: string, scratch: string) {
  const invalidEncoding: string[] = []
  const files = await contents(workspace, "", {}, invalidEncoding)
  const comparison = compareFiles(task.before, task.expected, files)
  const checker = path.join(scratch, "hidden-check.mjs")
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT)$/i.test(key)))
  Object.assign(environment, { HOME: scratch, USERPROFILE: scratch, TMP: scratch, TEMP: scratch, TMPDIR: scratch })
  const typescript = path.resolve("node_modules/typescript/bin/tsc")
  const checks = []
  if (invalidEncoding.length) checks.push({ name: "evaluation-encoding-integrity", passed: false, error: `Invalid UTF-8: ${invalidEncoding.join(", ")}` })
  for (const check of task.checks) {
    if (check.typecheck) {
      const result = await runProcess(process.execPath, ["--permission", `--allow-fs-read=${path.dirname(typescript)}`, `--allow-fs-read=${path.resolve("node_modules/typescript/lib")}`, `--allow-fs-read=${workspace}`, typescript, "--allowJs", "--checkJs", "--noEmit", "--skipLibCheck", "--target", "es2022", "--module", "nodenext", check.typecheck], { cwd: workspace, env: environment, timeoutMs: 10000 })
      const passed = result.code === 0 && !result.timedOut && !result.outputLimited
      checks.push({ name: check.name, passed, error: passed ? null : (result.stderr || result.stdout || "Typecheck failed").slice(0, 2500) })
      continue
    }
    const completion = `comparison-check-complete:${randomUUID()}`
    await writeFile(checker, [
      'import assert from "node:assert/strict"',
      `const base = ${JSON.stringify(pathToFileURL(workspace + path.sep).href)}`,
       `const files = ${JSON.stringify(files)}`, `const golden = ${JSON.stringify(task.expected)}`,
       'import vm from "node:vm"',
       'const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })',
       'const modules = new Map()',
       'const getModule = (file) => { if (!Object.hasOwn(files, file)) throw new Error("Module outside fixture: " + file); if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(files[file], { context, identifier: file })); return modules.get(file) }',
       'const linker = (specifier, parent) => { if (!specifier.startsWith("./") && !specifier.startsWith("../")) throw new Error("External module unavailable: " + specifier); const url = new URL(specifier, "file:///" + parent.identifier); return getModule(decodeURIComponent(url.pathname.slice(1))) }',
       'const loadModule = async (file) => { const module = getModule(file); if (module.status === "unlinked") await module.link(linker); if (module.status === "linked") await module.evaluate({ timeout: 1000 }); return module.namespace }',
       check.code,
       `process.stdout.write(${JSON.stringify(completion)})`,
    ].join("\n"))
    try {
      const result = await runProcess(process.execPath, ["--permission", `--allow-fs-read=${checker}`, "--experimental-vm-modules", checker], { cwd: scratch, env: environment, timeoutMs: 15000 })
      if (result.code !== 0 || result.timedOut || result.outputLimited || result.spawnError) throw new Error(result.stderr || result.spawnError || "Hidden check execution failed")
      if (!result.stdout.endsWith(completion)) throw new Error("Hidden assertions did not complete")
      checks.push({ name: check.name, passed: true, error: null })
    }
    catch (error) { checks.push({ name: check.name, passed: false, error: String((error as { stderr?: string }).stderr ?? error).replaceAll(workspace, "<workspace>").replaceAll(scratch, "<scratch>").slice(0, 3000) }) }
  }
  const afterChecks = await contents(workspace, "", {}, invalidEncoding)
  const checkMutations = [...new Set([...Object.keys(files), ...Object.keys(afterChecks)])].filter((file) => files[file] !== afterChecks[file])
  if (checkMutations.length) checks.push({ name: "evaluation-filesystem-integrity", passed: false, error: `Files changed during evaluation: ${checkMutations.join(", ")}` })
  const strictBytes = ["large-file", "crlf-unicode", "mixed-endings"].includes(task.id)
  const protectedRegionsPreserved = Object.entries(task.before).every(([file, before]) => {
    const regions = task.editableRegions?.[file]
    if (!regions?.length) return files[file] === before
    const actual = files[file]
    if (typeof actual !== "string") return false
    const prefix = before.slice(0, regions[0]!.start)
    const suffix = before.slice(regions.at(-1)!.end)
    if (!actual.startsWith(prefix) || !actual.endsWith(suffix) || actual.length < prefix.length + suffix.length) return false
    let position = prefix.length
    for (let index = 1; index < regions.length; index++) {
      const protectedText = before.slice(regions[index - 1]!.end, regions[index]!.start)
      const found = actual.indexOf(protectedText, position)
      if (found < 0 || found + protectedText.length > actual.length - suffix.length) return false
      position = found + protectedText.length
    }
    return true
  })
  const preservationSuccess = invalidEncoding.length === 0 && checkMutations.length === 0 && comparison.unrelatedFiles.length === 0 && protectedRegionsPreserved && (!strictBytes || comparison.exact)
  return { checks, functionalSuccess: checks.every((check) => check.passed), preservationSuccess, comparison }
}
