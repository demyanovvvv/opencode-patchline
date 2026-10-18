import { expect, it } from "vitest"
import { fingerprintLspCommand, verifyLspServer } from "../src/lsp/health.js"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

it("invalidates a nested project fingerprint after an ancestor workspace lock changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-workspace-lock-"))
  try {
    const project = path.join(root, "packages", "app")
    await mkdir(project, { recursive: true })
    const command = [process.execPath, "--stdio"]
    const before = await fingerprintLspCommand(command, project)
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n")
    const installed = await fingerprintLspCommand(command, project)
    expect(installed).not.toBe(before)
    await rm(path.join(root, "pnpm-lock.yaml"))
    expect(await fingerprintLspCommand(command, project)).not.toBe(installed)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it("invalidates fingerprints after project dependency lock changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-lock-fingerprint-"))
  try {
    const command = [process.execPath, "--stdio"]
    const before = await fingerprintLspCommand(command, root)
    await writeFile(path.join(root, "package-lock.json"), '{"lockfileVersion":3}')
    const installed = await fingerprintLspCommand(command, root)
    expect(installed).not.toBe(before)
    await writeFile(path.join(root, "package-lock.json"), '{"lockfileVersion":2}')
    expect(await fingerprintLspCommand(command, root)).not.toBe(installed)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it("fingerprints bare executables through PATH rather than the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-path-fingerprint-"))
  const previous = process.env.PATH
  try {
    process.env.PATH = root
    const binary = path.join(root, process.platform === "win32" ? "fixture-server.exe" : "fixture-server")
    await writeFile(binary, "before")
    const before = await fingerprintLspCommand(["fixture-server"], process.cwd())
    await writeFile(binary, "after")
    expect(await fingerprintLspCommand(["fixture-server"], process.cwd())).not.toBe(before)
  } finally { process.env.PATH = previous; await rm(root, { recursive: true, force: true }) }
})

it("invalidates command fingerprints when a launcher script changes at the same path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-health-fingerprint-"))
  try {
    const script = path.join(root, "server.js")
    await writeFile(script, "old")
    const before = await fingerprintLspCommand([process.execPath, script], root)
    expect(before).toMatch(/^[a-f0-9]{64}$/)
    await writeFile(script, "new")
    expect(await fingerprintLspCommand([process.execPath, script], root)).not.toBe(before)
    await rm(script)
    expect(await fingerprintLspCommand([process.execPath, script], root)).not.toBe(before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it("verifies an actual JSON-RPC initialize response and shuts down the server", async () => {
  const code = `let data='';process.stdin.on('data',chunk=>{data+=chunk;while(data.includes('\\r\\n\\r\\n')){const split=data.indexOf('\\r\\n\\r\\n');const length=Number(/Content-Length: (\\d+)/i.exec(data.slice(0,split))[1]);if(Buffer.byteLength(data.slice(split+4))<length)return;const body=data.slice(split+4,split+4+length);data=data.slice(split+4+length);const request=JSON.parse(body);if(request.id){const result=request.method==='initialize'?{capabilities:{documentSymbolProvider:true}}:null;const response=JSON.stringify({jsonrpc:'2.0',id:request.id,result});process.stdout.write('Content-Length: '+Buffer.byteLength(response)+'\\r\\n\\r\\n'+response)}if(request.method==='exit')process.exit(0)}})`
  const result = await verifyLspServer([process.execPath, "-e", code], process.cwd(), { timeoutMs: 2000 })
  expect(result).toMatchObject({ verified: true, capabilities: { documentSymbolProvider: true } })
})

it("rejects a process that starts but never implements LSP", async () => {
  await expect(verifyLspServer([process.execPath, "-e", "setInterval(()=>{},1000)"], process.cwd(), { timeoutMs: 100 })).rejects.toThrow("timed out")
})

it.each([{}, { capabilities: null }, { capabilities: [] }, { capabilities: "available" }, true])("does not verify malformed initialize capabilities (%j)", async (result) => {
  const code = `process.stdin.once('data',()=>{const body=JSON.stringify({jsonrpc:'2.0',id:1,result:${JSON.stringify(result)}});process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body)});setInterval(()=>{},1000)`
  await expect(verifyLspServer([process.execPath, "-e", code], process.cwd(), { timeoutMs: 2000 })).rejects.toThrow(/capabilities/)
})

it("accepts a valid empty capabilities object without inventing providers", async () => {
  const code = `process.stdin.once('data',()=>{const body=JSON.stringify({jsonrpc:'2.0',id:1,result:{capabilities:{}}});process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body)});setInterval(()=>{},1000)`
  expect(await verifyLspServer([process.execPath, "-e", code], process.cwd(), { timeoutMs: 2000 })).toEqual({ verified: true, capabilities: {} })
})

it.each([
  "process.stdout.write('Content-Length: 1048577\\r\\n\\r\\n')",
  "process.stdout.write('x'.repeat(8193))",
  "process.stdout.write('Content-Length: 9007199254740993\\r\\n\\r\\n')",
  "const body=JSON.stringify({jsonrpc:'2.0',method:'window/logMessage',params:{message:'x'.repeat(4096)}});const frame='Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body;process.stdout.write(frame.repeat(300))",
])("rejects oversized probe framing before waiting for its body (%s)", async (write) => {
  const code = `process.stdin.once('data',()=>{${write}});setInterval(()=>{},1000)`
  await expect(verifyLspServer([process.execPath, "-e", code], process.cwd(), { timeoutMs: 1000 })).rejects.toThrow(/size limit/)
})

it("parses byte-framed Unicode notifications before the initialize response", async () => {
  const code = `process.stdin.once('data',()=>{const frame=message=>{const body=JSON.stringify(message);return Buffer.from('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body)};const output=Buffer.concat([frame({jsonrpc:'2.0',method:'window/logMessage',params:{message:'Готово 🔧'}}),frame({jsonrpc:'2.0',id:1,result:{capabilities:{documentSymbolProvider:true}}})]);const split=output.indexOf(Buffer.from('Г'))+1;process.stdout.write(output.subarray(0,split));setTimeout(()=>process.stdout.write(output.subarray(split)),20)});setInterval(()=>{},1000)`
  expect(await verifyLspServer([process.execPath, "-e", code], process.cwd(), { timeoutMs: 2000 })).toMatchObject({ verified: true, capabilities: { documentSymbolProvider: true } })
})

it("initializes the server against the actual project root instead of a placeholder workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-health-root-"))
  try {
    const uri = pathToFileURL(root).href
    const code = `let data='';process.stdin.on('data',chunk=>{data+=chunk;const split=data.indexOf('\\r\\n\\r\\n');if(split<0)return;const length=Number(/Content-Length: (\\d+)/i.exec(data.slice(0,split))[1]);if(Buffer.byteLength(data.slice(split+4))<length)return;const request=JSON.parse(data.slice(split+4));const valid=request.params.rootUri===${JSON.stringify(uri)}&&request.params.workspaceFolders[0].uri===${JSON.stringify(uri)};const body=JSON.stringify({jsonrpc:'2.0',id:request.id,...(valid?{result:{capabilities:{documentSymbolProvider:true}}}:{error:{code:-32602,message:'wrong project root'}})});process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body)});setInterval(()=>{},1000)`
    expect(await verifyLspServer([process.execPath, "-e", code], root, { timeoutMs: 2000 })).toMatchObject({ verified: true, capabilities: { documentSymbolProvider: true } })
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) }
})

it("terminates the verified server before returning its capabilities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patchline-health-cleanup-"))
  const pidFile = path.join(root, "pid")
  let pid: number | undefined
  try {
    const code = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.stdin.once('data',()=>{const body=JSON.stringify({jsonrpc:'2.0',id:1,result:{capabilities:{documentSymbolProvider:true}}});process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body)});setInterval(()=>{},1000)`
    expect(await verifyLspServer([process.execPath, "-e", code], root, { timeoutMs: 2000 })).toMatchObject({ verified: true })
    pid = Number(await readFile(pidFile, "utf8"))
    expect(() => process.kill(pid!, 0)).toThrow()
  } finally {
    if (pid) { try { process.kill(pid) } catch { /* already stopped */ } }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
