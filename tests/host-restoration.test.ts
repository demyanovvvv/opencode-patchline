import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { prepareHostRecovery, recordHostInstall, planHostRestore, restoreOriginalHost, releaseHostOwner, claimExistingHost, recordHostProtection } from "../src/installation/host-recovery.js"
import { installHostBinary } from "../src/installation/files.js"
import { uninstallPatchline } from "../src/installer.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "patchline-host-restore-")))
  roots.push(root)
  const target = path.join(root, "opencode")
  await writeFile(target, "stock")
  return { root, target, owner: path.join(root, ".opencode-patchline-state.json") }
}
async function integrated(target: string, owner: string, text = "integrated") {
  await prepareHostRecovery(target, "1.18.34")
  const source = `${target}.new`
  await writeFile(source, text)
  await installHostBinary(source, target)
  await recordHostInstall(target, owner)
}

describe("original host recovery", () => {
  it("retains the stock original across repeated integration updates", async () => {
    const { target, owner } = await workspace()
    await integrated(target, owner)
    await integrated(target, owner, "second")
    expect(await readFile(`${target}.patchline-original`, "utf8")).toBe("stock")
    expect(await readFile(`${target}.patchline-previous`, "utf8")).toBe("integrated")
    const plan = await planHostRestore(target, owner)
    await restoreOriginalHost(plan)
    expect(await readFile(target, "utf8")).toBe("stock")
  })
  it("refuses restoration while another project or global installation owns the host", async () => {
    const { root, target, owner } = await workspace()
    await integrated(target, owner)
    await recordHostInstall(target, path.join(root, "global-state.json"))
    await expect(planHostRestore(target, owner)).rejects.toThrow("other installations")
    expect(await readFile(target, "utf8")).toBe("integrated")
  })
  it.each(["binary", "backup"])("rejects externally changed %s without overwriting it", async (which) => {
    const { target, owner } = await workspace()
    await integrated(target, owner)
    await writeFile(which === "binary" ? target : `${target}.patchline-original`, "external")
    await expect(planHostRestore(target, owner)).rejects.toThrow("changed")
  })
  it("rechecks planned files after confirmation", async () => {
    const { target, owner } = await workspace()
    await integrated(target, owner)
    const plan = await planHostRestore(target, owner)
    await writeFile(target, "external")
    await expect(restoreOriginalHost(plan)).rejects.toThrow("changed")
    expect(await readFile(target, "utf8")).toBe("external")
  })
  it("allows delayed restoration after regular removal releases its owner", async () => {
    const { target, owner } = await workspace()
    await integrated(target, owner)
    await releaseHostOwner(target, owner)
    await restoreOriginalHost(await planHostRestore(target, owner))
    expect(await readFile(target, "utf8")).toBe("stock")
  })
  it("does not create a host lock when a --no-host install finds no tracked integration", async () => {
    const { target, owner } = await workspace()
    await writeFile(`${target}.patchline-update-lock`, "another operation")
    expect(await claimExistingHost(target, owner)).toBe(false)
    await expect(releaseHostOwner(target, owner)).resolves.toBeUndefined()
    expect(await readFile(`${target}.patchline-update-lock`, "utf8")).toBe("another operation")
  })
  it("does not claim a restored stock host", async () => {
    const { target, owner } = await workspace()
    await integrated(target, owner)
    await restoreOriginalHost(await planHostRestore(target, owner))
    expect(await claimExistingHost(target, owner)).toBe(false)
  })
  it("restores only owned autoupdate and preserves JSONC and unrelated edits", async () => {
    const { root, target, owner } = await workspace()
    await integrated(target, owner)
    const file = path.join(root, "opencode.jsonc")
    await writeFile(file, '{/* keep */"autoupdate":true,"theme":"old"}\n')
    const { readSnapshot } = await import("../src/installation/files.js")
    const before = (await readSnapshot(file))!
    await writeFile(file, '{/* keep */"autoupdate":"notify","theme":"old"}\n')
    await recordHostProtection(target, before, (await readSnapshot(file))!)
    await writeFile(file, '{/* keep */"autoupdate":"notify","theme":"new"}\n')
    await restoreOriginalHost(await planHostRestore(target, owner))
    const text = await readFile(file, "utf8")
    expect(text).toContain("/* keep */")
    expect(text).toContain('"theme":"new"')
    expect(text).toContain('"autoupdate":true')
  })
  it("preserves a user's changed autoupdate setting", async () => {
    const { root, target, owner } = await workspace()
    await integrated(target, owner)
    const file = path.join(root, "opencode.json")
    const { readSnapshot } = await import("../src/installation/files.js")
    await writeFile(file, '{"autoupdate":true}')
    const before = (await readSnapshot(file))!
    await writeFile(file, '{"autoupdate":"notify"}')
    await recordHostProtection(target, before, (await readSnapshot(file))!)
    await writeFile(file, '{"autoupdate":false}')
    await restoreOriginalHost(await planHostRestore(target, owner))
    expect(await readFile(file, "utf8")).toBe('{"autoupdate":false}')
  })
  it("refuses to infer the original from a rotating legacy backup", async () => {
    const { target, owner } = await workspace()
    await writeFile(`${target}.patchline-previous`, "unknown")
    await expect(planHostRestore(target, owner)).rejects.toThrow("verified original")
  })
  it("does not preserve an external replacement as the original after a build", async () => {
    const { target } = await workspace()
    const { captureHostRevision } = await import("../src/installation/host-runtime.js")
    const revision = await captureHostRevision(target)
    await writeFile(target, "external")
    await expect(prepareHostRecovery(target, "1.18.34", revision)).rejects.toThrow("changed")
    await expect(readFile(`${target}.patchline-original`)).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("rejects original backup symlinks and does not overwrite their target", async () => {
    const { root, target } = await workspace()
    const victim = path.join(root, "victim")
    await writeFile(victim, "user")
    const { symlink } = await import("node:fs/promises")
    try { await symlink(victim, `${target}.patchline-original`) } catch { return }
    await expect(prepareHostRecovery(target, "1.18.34")).rejects.toThrow()
    expect(await readFile(victim, "utf8")).toBe("user")
  })
  it("uninstaller previews and restores the host even after registrations are gone", async () => {
    const { root, target, owner } = await workspace()
    await integrated(target, owner)
    await writeFile(owner, JSON.stringify({ schemaVersion: 1, scope: "project", hostBinary: target }))
    expect(await uninstallPatchline({ cwd: root, restoreHost: true, dryRun: true, stdout: () => undefined })).toBe(0)
    expect(await readFile(target, "utf8")).toBe("integrated")
    expect(await uninstallPatchline({ cwd: root, restoreHost: true, yes: true, stdout: () => undefined })).toBe(0)
    expect(await readFile(target, "utf8")).toBe("stock")
  })
  it("restores global update preferences and removes registrations in the same JSONC file", async () => {
    const { root, target, owner } = await workspace()
    await integrated(target, owner)
    const file = path.join(root, "opencode.jsonc")
    const { readSnapshot } = await import("../src/installation/files.js")
    await writeFile(file, '{/* keep */"autoupdate":true,"plugin":["other","opencode-patchline"]}')
    const before = (await readSnapshot(file))!
    await writeFile(file, '{/* keep */"autoupdate":"notify","plugin":["other","opencode-patchline"]}')
    await recordHostProtection(target, before, (await readSnapshot(file))!)
    await writeFile(owner, JSON.stringify({ schemaVersion: 1, scope: "global", hostBinary: target }))
    expect(await uninstallPatchline({ cwd: root, global: true, configDirectory: root, restoreHost: true, keepDeps: true, yes: true, stdout() {}, stderr() {} })).toBe(0)
    const text = await readFile(file, "utf8")
    expect(text).toContain("/* keep */")
    expect(text).toContain('"autoupdate":true')
    expect(text).not.toContain("opencode-patchline")
    expect(text).toContain("other")
  })
  it("refuses removal before changing registrations when another owner blocks restoration", async () => {
    const { root, target, owner } = await workspace()
    await integrated(target, owner)
    await recordHostInstall(target, path.join(root, "another-project-state.json"))
    await writeFile(owner, JSON.stringify({ schemaVersion: 1, scope: "project", hostBinary: target }))
    const file = path.join(root, "opencode.json")
    await writeFile(file, '{"plugin":["opencode-patchline"]}')
    expect(await uninstallPatchline({ cwd: root, restoreHost: true, yes: true, stdout() {}, stderr() {} })).toBe(1)
    expect(await readFile(file, "utf8")).toContain("opencode-patchline")
    expect(await readFile(target, "utf8")).toBe("integrated")
  })
})
