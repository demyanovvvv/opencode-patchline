import { readFile, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { transformAsync } from "@babel/core"
import solid from "babel-preset-solid"

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true })
const command = process.platform === "win32" ? "npx.cmd" : "npx"
const child = spawn(command, ["tsc", "-p", "tsconfig.build.json"], { stdio: "inherit", windowsHide: true, shell: process.platform === "win32" })
child.on("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
const exitCode = await new Promise((resolve) => child.on("close", resolve))
if (exitCode !== 0) {
  process.exitCode = exitCode ?? 1
} else {
  const filename = new URL("../dist/tui.jsx", import.meta.url)
  let source
  try {
    source = await readFile(filename, "utf8")
  } catch (error) {
    throw new Error(`TUI source was not emitted by TypeScript: ${filename.pathname}`, { cause: error })
  }
  const transformed = await transformAsync(source, {
    filename: "tui.jsx",
    configFile: false,
    babelrc: false,
    presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }]],
    inputSourceMap: JSON.parse(await readFile(new URL("../dist/tui.jsx.map", import.meta.url), "utf8")),
    sourceMaps: true,
  })
  if (!transformed?.code) throw new Error("Solid TUI transform produced no code")
  await writeFile(new URL("../dist/tui.js", import.meta.url), `${transformed.code}\n//# sourceMappingURL=tui.js.map\n`)
  await writeFile(new URL("../dist/tui.js.map", import.meta.url), JSON.stringify(transformed.map))
  await rm(filename)
  await rm(new URL("../dist/tui.jsx.map", import.meta.url))
}
