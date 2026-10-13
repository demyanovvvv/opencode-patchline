import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"

const available = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0
describe.skipIf(!available)("PowerShell package wrappers", () => {
  for (const action of ["install", "uninstall"]) {
    for (const source of [true, false]) {
      it(`${action} uses a built ${source ? "checkout" : "release"} and forwards literal arguments and status`, () => {
        const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), "patchline wrapper ' ")))
        try {
          copyFileSync(path.resolve(`${action}.ps1`), path.join(directory, `${action}.ps1`))
          writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "opencode-patchline" }))
          mkdirSync(path.join(directory, "dist"))
          writeFileSync(path.join(directory, "dist", "cli.js"), "")
          if (source) { mkdirSync(path.join(directory, "src")); writeFileSync(path.join(directory, "src", "cli.ts"), "") }
          const file = path.join(directory, `${action}.ps1`).replaceAll("'", "''")
          const result = spawnSync("pwsh", ["-NoProfile", "-Command",
            `function global:node { if ($args[0] -eq '-e') { $global:LASTEXITCODE = 0; return }; ConvertTo-Json -Compress -InputObject @($args); (Get-Location).Path; $global:LASTEXITCODE = 23 }; & '${file}' --global --lang=ru --cwd 'argument with spaces & ;'; exit $LASTEXITCODE`,
          ], { encoding: "utf8", cwd: path.resolve("tests") })
          expect(result.stderr).toBe("")
          expect(result.status).toBe(23)
          const lines = result.stdout.trim().split(/\r?\n/)
          const forwarded = JSON.parse(lines[0]!) as string[]
          expect(realpathSync.native(forwarded[0]!)).toBe(realpathSync.native(path.join(directory, "dist", "cli.js")))
          expect(forwarded.slice(1)).toEqual([action, ...(action === "install" ? ["--local"] : []), "--global", "--lang=ru", "--cwd", "argument with spaces & ;"])
          expect(realpathSync.native(lines[1]!)).toBe(realpathSync.native(path.resolve("tests")))
        } finally { rmSync(directory, { recursive: true, force: true }) }
      })
    }
    it(`${action} explains a missing package without npm access`, () => {
      const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), "patchline wrapper ")))
      try {
        copyFileSync(path.resolve(`${action}.ps1`), path.join(directory, `${action}.ps1`))
        const file = path.join(directory, `${action}.ps1`).replaceAll("'", "''")
        const result = spawnSync("pwsh", ["-NoProfile", "-Command", `function global:npx { throw 'Registry access' }; & '${file}'; exit $LASTEXITCODE`], { encoding: "utf8" })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain("release")
        expect(result.stderr).not.toContain("Registry access")
      } finally { rmSync(directory, { recursive: true, force: true }) }
    })
  }
})

const shell = process.env.PATCHLINE_TEST_SH ?? (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "sh")
const shellAvailable = spawnSync(shell, ["-c", "exit 0"]).status === 0
describe.skipIf(!shellAvailable)("POSIX package wrappers", () => {
  for (const action of ["install", "uninstall"]) {
    it(`${action} uses the adjacent release and preserves argv, cwd and status`, () => {
      const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), "patchline wrapper ' ")))
      try {
        copyFileSync(path.resolve(`${action}.sh`), path.join(directory, `${action}.sh`))
        writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "opencode-patchline" }))
        mkdirSync(path.join(directory, "dist"))
        writeFileSync(path.join(directory, "dist", "cli.js"), "console.log(JSON.stringify(process.argv.slice(2))); console.log(process.cwd()); process.exitCode=23")
        const result = spawnSync(shell, [path.join(directory, `${action}.sh`).replaceAll("\\", "/"), "--global", "--lang=ru", "--cwd", "spaces & ; '"], { encoding: "utf8", cwd: path.resolve("tests") })
        expect(result.stderr).toBe("")
        expect(result.status).toBe(23)
        const lines = result.stdout.trim().split(/\r?\n/)
        expect(JSON.parse(lines[0]!)).toEqual([action, ...(action === "install" ? ["--local"] : []), "--global", "--lang=ru", "--cwd", "spaces & ; '"])
        expect(realpathSync.native(lines[1]!)).toBe(realpathSync.native(path.resolve("tests")))
      } finally { rmSync(directory, { recursive: true, force: true }) }
    })
  }
})
