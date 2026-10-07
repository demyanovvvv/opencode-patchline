import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { grepWorkspace } from "../src/search/grep.js"
import { summarizeLatencies } from "./stats.js"

const root = await mkdtemp(path.join(os.tmpdir(), "patchline-scale-"))
try {
  for (let directory = 0; directory < 40; directory++) {
    const folder = path.join(root, `d${directory.toString().padStart(2, "0")}`)
    await mkdir(folder)
    await Promise.all(Array.from({ length: 250 }, (_, file) => writeFile(path.join(folder, `f${file}.ts`), "const needle = 1\n")))
  }
  const samples: number[] = []
  for (let run = 0; run < 5; run++) {
    const start = performance.now()
    const result = await grepWorkspace({ worktree: root, pattern: "needle", maxResults: 1 })
    if (result.matches.length !== 1 || !result.truncated) throw new Error("Search result invariant failed")
    samples.push(performance.now() - start)
  }
  console.log(JSON.stringify({ files: 10_000, scenario: "early-match-global-enumeration", latencyMs: summarizeLatencies(samples), peakRssBytes: process.resourceUsage().maxRSS * 1024 }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
