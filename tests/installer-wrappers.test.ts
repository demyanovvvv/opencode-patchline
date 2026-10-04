import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"

const powershell = "pwsh"
const available = spawnSync(powershell, ["-NoProfile", "-Command", "exit 0"]).status === 0

describe.skipIf(!available)("PowerShell installer wrappers", () => {
  for (const action of ["install", "uninstall"]) {
    it(`${action} forwards arguments, working directory and failure exit code`, () => {
      const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "patchline wrapper ")))
      copyFileSync(path.resolve(`${action}.ps1`), path.join(directory, `${action}.ps1`))
      const file = path.join(directory, `${action}.ps1`).replaceAll("'", "''")
      const name = process.platform === "win32" ? "npx.cmd" : "npx"
      const result = spawnSync(powershell, ["-NoProfile", "-Command",
        `function global:${name} { ConvertTo-Json -Compress -InputObject @($args); (Get-Location).Path; $global:LASTEXITCODE = 23 }; & '${file}' --global --lang ru --yes 'argument with spaces'; exit $LASTEXITCODE`,
      ], { encoding: "utf8", cwd: path.resolve("tests") })
      rmSync(directory, { recursive: true, force: true })
      expect(result.stderr).toBe("")
      expect(result.status).toBe(23)
      const lines = result.stdout.trim().split(/\r?\n/)
      expect(JSON.parse(lines[0]!)).toEqual(["--yes", "opencode-patchline@latest", action, "--global", "--lang", "ru", "--yes", "argument with spaces"])
      expect(lines[1]).toBe(path.resolve("tests"))
    })
  }

  for (const built of [true, false]) {
    it(`uses the source checkout ${built ? "CLI" : "build instructions without registry access"}`, () => {
      const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "patchline checkout ")))
      try {
        copyFileSync(path.resolve("install.ps1"), path.join(directory, "install.ps1"))
        mkdirSync(path.join(directory, "src"))
        writeFileSync(path.join(directory, "src", "cli.ts"), "")
        writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "opencode-patchline" }))
        if (built) {
          mkdirSync(path.join(directory, "dist"))
          writeFileSync(path.join(directory, "dist", "cli.js"), "")
        }
        const file = path.join(directory, "install.ps1").replaceAll("'", "''")
        const name = process.platform === "win32" ? "npx.cmd" : "npx"
        const result = spawnSync(powershell, ["-NoProfile", "-Command",
          `function global:${name} { throw 'Unexpected registry access' }; function global:node { ConvertTo-Json -Compress -InputObject @($args); (Get-Location).Path; $global:LASTEXITCODE = 23 }; & '${file}' --global --lang ru 'argument with spaces'; exit $LASTEXITCODE`,
        ], { encoding: "utf8", cwd: path.resolve("tests") })
        if (built) {
          expect(result.stderr).toBe("")
          expect(result.status).toBe(23)
          const lines = result.stdout.trim().split(/\r?\n/)
          const forwarded = JSON.parse(lines[0]!) as string[]
          expect(path.basename(forwarded[0]!)).toBe("cli.js")
          expect(path.basename(path.dirname(forwarded[0]!))).toBe("dist")
          expect(forwarded.slice(1)).toEqual(["install", "--local", "--global", "--lang", "ru", "argument with spaces"])
          expect(lines[1]).toBe(path.resolve("tests"))
        } else {
          expect(result.status).toBe(1)
          expect(result.stderr).toContain("npm install")
          expect(result.stderr).toContain("npm run build")
          expect(result.stderr).not.toContain("Unexpected registry access")
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})

const shell = spawnSync("sh", ["-c", "exit 0"]).status === 0
describe.skipIf(!shell)("shell installer wrappers", () => {
  for (const action of ["install", "uninstall"]) {
    it(`${action} forwards arguments and failure exit code`, () => {
      // Source inside a subshell with stub commands: exec calls the exported npx
      // function in bash, avoiding network/package changes during verification.
      const bash = spawnSync("bash", ["--version"]).status === 0
      if (!bash) return
      const file = path.resolve(`${action}.sh`).replaceAll("\\", "/").replaceAll("'", "'\\''")
      const result = spawnSync("bash", ["-c", `node() { :; }; npx() { printf '<%s>\\n' "$@"; exit 23; }; exec() { "$@"; }; . '${file}' --global --lang ru 'argument with spaces'`], { encoding: "utf8" })
      expect(result.status).toBe(23)
      expect(result.stdout.trim().split(/\r?\n/)).toEqual(["<--yes>", "<opencode-patchline@latest>", `<${action}>`, "<--global>", "<--lang>", "<ru>", "<argument with spaces>"])
    })
  }
})
