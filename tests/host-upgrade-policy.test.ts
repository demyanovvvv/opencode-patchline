import { expect, it } from "vitest"
import { installedUpstreamVersion, patchHostStartup, patchHostUpdates, hostBuildTarget, assertOwnedHostAdapter, patchHostUpgradeCommand, patchHostTuiUpdate } from "../src/installer.js"

it("preserves the installed upstream during plugin installation", () => {
  expect(installedUpstreamVersion("1.18.35+patchline.1.2.1")).toBe("1.18.35")
  expect(installedUpstreamVersion("1.19.0")).toBe("1.19.0")
  expect(() => installedUpstreamVersion("1.19.0-beta.1")).toThrow()
  expect(() => installedUpstreamVersion("missing")).toThrow()
})

it("delegates upgrades to host-only operation without plugin installation", () => {
  const source = 'upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {'
  const result = patchHostUpdates(source, "C:/permanent package/dist/cli.js")
  expect(result).toContain('"host-upgrade"')
  expect(result).not.toContain('"install", "--local"')
  expect(result).toContain('InstallationVersion.includes("+patchline.")')
  expect(result).toContain('"--host-binary", process.execPath')
  expect(result).toContain('"--expected-host-version", InstallationVersion')
  expect(patchHostUpdates(result, "C:/permanent package/dist/cli.js")).toBe(result)
})

it("retains the integrated host when OpenCode offers an unsupported major migration", () => {
  const source = 'upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {\n}\nupgradeMajor: Effect.fn("Installation.upgradeMajor")(function* (m: Method) {'
  const result = patchHostUpdates(source, "cli.js")
  expect(result).toContain('Unsupported OpenCode major upgrade')
  expect(patchHostUpdates(result, "cli.js")).toBe(result)
})

it("migrates exactly the previously owned upgrade adapter", () => {
  const source = 'upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {'
  const current = patchHostUpdates(source, "cli.js")
  const legacy = current.replace(', "--host-binary", process.execPath, "--expected-host-version", InstallationVersion', "").replace('"host-upgrade"', '"install", "--local", "--global", "--yes"')
  expect(() => assertOwnedHostAdapter("packages/opencode/src/installation/index.ts", source, legacy, "cli.js")).not.toThrow()
  expect(() => assertOwnedHostAdapter("packages/opencode/src/installation/index.ts", source, legacy + "\nunknown", "cli.js")).toThrow(/Unowned/)
  expect(patchHostUpdates(legacy, "cli.js")).toBe(current)
})

it("normalizes version comparisons in the 1.19 notification policy", () => {
  const source = 'if (input.always) return true\n  return input.current !== input.latest'
  const patched = patchHostStartup(source)
  expect(patched).toContain('input.current.split("+")[0] !== input.latest')
  expect(patchHostStartup(patched)).toBe(patched)
  expect(() => patchHostStartup("unknown")).toThrow(/Unsupported/)
})

it("normalizes the 1.19 installation version before shouldNotify compares it", () => {
  const source = "current: InstallationVersion,\n      latest,"
  expect(patchHostStartup(source)).toContain('current: InstallationVersion.split("+")[0],')
})

it("selects platform-specific host artifacts", () => {
  expect(hostBuildTarget("win32", "x64")).toEqual({ directory: "opencode-windows-x64", executable: "opencode.exe" })
  expect(hostBuildTarget("darwin", "arm64")).toEqual({ directory: "opencode-darwin-arm64", executable: "opencode" })
  expect(hostBuildTarget("linux", "x64")).toEqual({ directory: "opencode-linux-x64", executable: "opencode" })
  expect(() => hostBuildTarget("freebsd", "x64")).toThrow(/Unsupported/)
})

it("normalizes CLI comparisons and allows unknown installation methods for integrated hosts", () => {
  const source = 'if (method === "unknown") {\nif (InstallationVersion === target) {'
  const patched = patchHostUpgradeCommand(source)
  expect(patched).toContain('InstallationVersion.split("+")[0] === target')
  expect(patched).toContain('!InstallationVersion.includes("+patchline.")')
  expect(patchHostUpgradeCommand(patched)).toBe(patched)
  expect(() => patchHostUpgradeCommand("unknown")).toThrow(/Unsupported/)
})

it("uses upstream comparisons and the coordinated path for the 1.19 TUI updater", () => {
  const source = 'return { current: InstallationVersion, latest: await Installation.latest(await Installation.method()) }\nif (method === "unknown") throw new Error("Installation method not found")'
  const patched = patchHostTuiUpdate(source)
  expect(patched).toContain('current: InstallationVersion.split("+")[0],')
  expect(patched).toContain('!InstallationVersion.includes("+patchline.")')
  expect(patchHostTuiUpdate(patched)).toBe(patched)
})
