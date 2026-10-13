import { expect, it } from "vitest"
import { verifyLspServer } from "../src/lsp/health.js"

it("verifies an actual JSON-RPC initialize response and shuts down the server", async () => {
  const code = `let data='';process.stdin.on('data',chunk=>{data+=chunk;while(data.includes('\\r\\n\\r\\n')){const split=data.indexOf('\\r\\n\\r\\n');const length=Number(/Content-Length: (\\d+)/i.exec(data.slice(0,split))[1]);if(Buffer.byteLength(data.slice(split+4))<length)return;const body=data.slice(split+4,split+4+length);data=data.slice(split+4+length);const request=JSON.parse(body);if(request.id){const result=request.method==='initialize'?{capabilities:{documentSymbolProvider:true}}:null;const response=JSON.stringify({jsonrpc:'2.0',id:request.id,result});process.stdout.write('Content-Length: '+Buffer.byteLength(response)+'\\r\\n\\r\\n'+response)}if(request.method==='exit')process.exit(0)}})`
  const result = await verifyLspServer([process.execPath, "-e", code], process.cwd(), { timeoutMs: 2000 })
  expect(result).toMatchObject({ verified: true, capabilities: { documentSymbolProvider: true } })
})

it("rejects a process that starts but never implements LSP", async () => {
  await expect(verifyLspServer([process.execPath, "-e", "setInterval(()=>{},1000)"], process.cwd(), { timeoutMs: 100 })).rejects.toThrow("timed out")
})
