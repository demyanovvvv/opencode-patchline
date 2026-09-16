import { readFile } from "node:fs/promises"

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8")
const ref = process.env.GITHUB_REF_NAME ?? process.argv[2]

if (ref === undefined || ref.length === 0) throw new Error("A release tag is required (for example: v1.0.0).")
const expected = `v${packageJson.version}`
if (ref !== expected) throw new Error(`Release tag ${ref} does not match package version ${packageJson.version} (expected ${expected}).`)
if (!changelog.includes(`## ${packageJson.version}`)) {
  throw new Error(`CHANGELOG.md does not contain a released section for ${packageJson.version}.`)
}

console.log(`Release metadata verified: ${packageJson.name}@${packageJson.version} (${ref})`)
