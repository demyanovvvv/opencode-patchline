import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

const execute = promisify(execFile)
let output
const cli = process.env.npm_execpath
if (!cli || path.extname(cli) !== ".js") throw new Error("Run dependency audit through npm.")
try { output = (await execute(process.execPath, [cli, "audit", "--omit=dev", "--json"], { maxBuffer: 5_000_000 })).stdout }
catch (error) {
  if (!error.stdout) throw error
  output = error.stdout
}
const report = JSON.parse(output)
if (report.error) throw new Error(`Dependency audit failed: ${report.error.summary ?? "registry unavailable"}`)
const entries = Object.values(report.vulnerabilities ?? {})
const high = entries.filter((entry) => entry.severity === "high" || entry.severity === "critical")
for (const entry of high) {
  const paths = entry.nodes?.join(", ") ?? "unknown path"
  const fixes = entry.fixAvailable ? `${entry.fixAvailable.name}@${entry.fixAvailable.version}` : "no automatic fix"
  console.log(`${entry.severity}: ${entry.name}; paths=${paths}; fix=${fixes}`)
}
if (high.length > 0) {
  console.error(`Dependency audit found ${high.length} high/critical package advisories. Resolve with a compatible lockfile update before release.`)
  process.exitCode = 1
} else console.log("Dependency audit passed: no high/critical advisories.")
