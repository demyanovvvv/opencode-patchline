import { constants } from "node:fs"
import { copyFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { assertBinaryCurrent, assertCurrent, commitConfigurations, readBinarySnapshot, readSnapshot, replaceHostFromSnapshot, saveState, type BinarySnapshot, type FileChange, type FileSnapshot } from "./files.js"
import { withHostLock, type HostRevision } from "./host-runtime.js"

type Protection = { file: string; existed: boolean; value?: boolean | "notify" }
type Receipt = { schemaVersion: 1; target: string; originalDigest: string; installedDigest: string; originalVersion: string; owners: string[]; protection?: Protection }
export type HostRestorePlan = { target: BinarySnapshot; original: BinarySnapshot; receipt: FileSnapshot; config?: FileChange; originalVersion: string }
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const receiptFile = (target: string) => `${target}.patchline-recovery.json`
const originalFile = (target: string) => `${target}.patchline-original`

async function receiptOf(target: string): Promise<{ state: Receipt; snapshot: FileSnapshot } | undefined> {
  const snapshot = await readSnapshot(receiptFile(target))
  if (!snapshot) return undefined
  const state = JSON.parse(snapshot.source) as Receipt
  if (!state || state.schemaVersion !== 1 || state.target !== target || !path.isAbsolute(target) ||
      !/^[a-f0-9]{64}$/.test(state.originalDigest) || !/^[a-f0-9]{64}$/.test(state.installedDigest) ||
      !/^1\.\d+\.\d+$/.test(state.originalVersion) || !Array.isArray(state.owners) || state.owners.some((owner) => typeof owner !== "string" || !path.isAbsolute(owner))) {
    throw new Error("Invalid host recovery ownership record.")
  }
  const preference = state.protection
  if (preference && (typeof preference.file !== "string" || !path.isAbsolute(preference.file) || typeof preference.existed !== "boolean" ||
      (preference.value !== undefined && preference.value !== true && preference.value !== false && preference.value !== "notify"))) throw new Error("Invalid host update ownership record.")
  return { state, snapshot }
}

async function checkedBinary(file: string, expected: string): Promise<BinarySnapshot> {
  const snapshot = await readBinarySnapshot(file)
  if (!snapshot || digest(snapshot.bytes) !== expected) throw new Error(`Host or original backup changed: ${file}`)
  return snapshot
}

async function updateReceipt(snapshot: FileSnapshot, state: Receipt): Promise<() => Promise<void>> {
  await assertCurrent(snapshot)
  await commitConfigurations([{ ...snapshot, text: `${JSON.stringify(state, null, 2)}\n` }], () => {})
  const landed = await readSnapshot(snapshot.path)
  if (!landed) throw new Error("Host ownership record disappeared.")
  return async () => { await commitConfigurations([{ ...landed, text: snapshot.source }], () => {}) }
}

/** Called while holding the per-binary host lock, before the first replacement. */
export async function prepareHostRecovery(target: string, version: string, expected?: HostRevision): Promise<boolean> {
  if (expected) {
    const current = await checkedBinary(target, expected.digest)
    if (current.identity.device !== expected.identity.device || current.identity.inode !== expected.identity.inode) throw new Error("Host changed while preparing its original backup.")
  }
  const receipt = await receiptOf(target)
  if (receipt) {
    await checkedBinary(target, receipt.state.installedDigest)
    await checkedBinary(originalFile(target), receipt.state.originalDigest)
    return true
  }
  // An already-integrated legacy executable is not evidence of a stock original.
  if (version.includes("+patchline.")) return false
  if (!/^1\.\d+\.\d+$/.test(version)) throw new Error("Cannot preserve an unsupported original host version.")
  const original = await readBinarySnapshot(target)
  if (!original) throw new Error("OpenCode binary is unavailable.")
  await assertBinaryCurrent(original)
  await copyFile(target, originalFile(target), constants.COPYFILE_EXCL)
  const saved = await checkedBinary(originalFile(target), digest(original.bytes))
  await assertBinaryCurrent(original)
  await assertBinaryCurrent(saved)
  await saveState(receiptFile(target), { schemaVersion: 1, target, originalDigest: digest(original.bytes), installedDigest: digest(original.bytes), originalVersion: version, owners: [] } satisfies Receipt)
  return true
}

/** The caller holds the host lock. Only a successful installer may claim an owner. */
export async function recordHostInstall(target: string, owner?: string): Promise<(() => Promise<void>) | undefined> {
  const receipt = await receiptOf(target)
  if (!receipt) return
  await checkedBinary(originalFile(target), receipt.state.originalDigest)
  const installed = await readBinarySnapshot(target)
  if (!installed) throw new Error("OpenCode binary is unavailable.")
  const owners = owner ? [...new Set([...receipt.state.owners, owner])] : receipt.state.owners
  await assertBinaryCurrent(installed)
  return await updateReceipt(receipt.snapshot, { ...receipt.state, installedDigest: digest(installed.bytes), owners })
}

export async function recordHostProtection(target: string, before: FileSnapshot, landed: FileSnapshot): Promise<(() => Promise<void>) | undefined> {
  const receipt = await receiptOf(target)
  if (!receipt || receipt.state.protection) return
  await assertCurrent(landed)
  const config = parse(before.source.replace(/^\uFEFF/, "")) as Record<string, unknown>
  const protection: Protection = { file: before.path, existed: Object.hasOwn(config, "autoupdate") }
  if (config.autoupdate === true || config.autoupdate === false || config.autoupdate === "notify") protection.value = config.autoupdate
  return await updateReceipt(receipt.snapshot, { ...receipt.state, protection })
}

export async function releaseHostOwner(target: string, owner: string): Promise<void> {
  if (!await receiptOf(target)) return
  await withHostLock(target, async () => {
    const receipt = await receiptOf(target)
    if (!receipt || !receipt.state.owners.includes(owner)) return
    await updateReceipt(receipt.snapshot, { ...receipt.state, owners: receipt.state.owners.filter((item) => item !== owner) })
  })
}

export async function hostRecoveryRollback(target: string, before: FileSnapshot | undefined): Promise<(() => Promise<void>) | undefined> {
  const landed = await receiptOf(target)
  if (!landed) return undefined
  const state = { ...landed.state }
  delete state.protection
  const source = before?.source ?? `${JSON.stringify({ ...state, installedDigest: state.originalDigest, owners: [] }, null, 2)}\n`
  return async () => { await commitConfigurations([{ ...landed.snapshot, text: source }], () => {}) }
}

export async function claimExistingHost(target: string, owner: string): Promise<boolean> {
  const receipt = await receiptOf(target)
  if (!receipt || receipt.state.installedDigest === receipt.state.originalDigest) return false
  return await withHostLock(target, () => claimHostDuringInstall(target, owner))
}

export async function claimHostDuringInstall(target: string, owner: string): Promise<boolean> {
  const receipt = await receiptOf(target)
  if (!receipt || receipt.state.installedDigest === receipt.state.originalDigest) return false
  await checkedBinary(target, receipt.state.installedDigest)
  await recordHostInstall(target, owner)
  return true
}

export async function planHostRestore(target: string, owner: string): Promise<HostRestorePlan> {
  const receipt = await receiptOf(target)
  if (!receipt) throw new Error("No verified original OpenCode backup is available. Legacy rotating backups cannot be restored automatically.")
  if (receipt.state.owners.some((item) => item !== owner)) throw new Error(`Host is used by other installations: ${receipt.state.owners.filter((item) => item !== owner).join(", ")}`)
  const installed = await checkedBinary(target, receipt.state.installedDigest)
  const original = await checkedBinary(originalFile(target), receipt.state.originalDigest)
  const plan: HostRestorePlan = { target: installed, original, receipt: receipt.snapshot, originalVersion: receipt.state.originalVersion }
  const preference = receipt.state.protection
  if (preference) {
    const file = await readSnapshot(preference.file)
    if (file) {
      const bom = file.source.startsWith("\uFEFF") ? "\uFEFF" : ""
      const source = file.source.slice(bom.length)
      const errors: ParseError[] = []
      const config = parse(source, errors, { allowTrailingComma: true }) as Record<string, unknown>
      if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid OpenCode update configuration.")
      if (config.autoupdate === "notify") {
        const text = bom + applyEdits(source, modify(source, ["autoupdate"], preference.existed ? preference.value : undefined, {}))
        if (text !== file.source) plan.config = { ...file, text }
      }
    }
  }
  return plan
}

export async function restoreOriginalHost(plan: HostRestorePlan): Promise<void> {
  await withHostLock(plan.target.path, async () => {
    await assertCurrent(plan.receipt)
    await assertBinaryCurrent(plan.target)
    await assertBinaryCurrent(plan.original)
    if (plan.config) await assertCurrent(plan.config)
    let rollback: (() => Promise<void>) | undefined
    let configLanded: FileSnapshot | undefined
    try {
      await replaceHostFromSnapshot(plan.original, plan.target, (restore) => { rollback = restore })
      if (plan.config) {
        await commitConfigurations([plan.config], () => {})
        configLanded = await readSnapshot(plan.config.path)
      }
      const state = JSON.parse(plan.receipt.source) as Receipt
      const restored = { ...state }
      delete restored.protection
      await updateReceipt(plan.receipt, { ...restored, installedDigest: state.originalDigest, owners: [] })
    } catch (error) {
      const conflicts: string[] = []
      if (configLanded && plan.config) {
        try { await commitConfigurations([{ ...configLanded, text: plan.config.source }], () => {}) }
        catch (conflict) { conflicts.push(String(conflict)) }
      }
      try { await rollback?.() } catch (conflict) { conflicts.push(String(conflict)) }
      if (conflicts.length) throw new Error(`Host restoration rollback conflicts: ${conflicts.join("; ")}`, { cause: error })
      throw error
    }
  })
}
