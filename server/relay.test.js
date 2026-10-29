// Transferência direta: token validado por um servidor de mentira. Só dados sintéticos em diretórios temporários.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'passagem-relay-'))
const MB = 1048576
const tokenA = crypto.randomBytes(16).toString('hex'), tokenA2 = tokenA, tokenB = crypto.randomBytes(16).toString('hex')
const free = async () => { const l = net.createServer(); await new Promise(r => l.listen(0, '127.0.0.1', r)); const p = l.address().port; await new Promise(r => l.close(r)); return p }
let validatorUp = true
const validator = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const { token } = JSON.parse(b || '{}')
    if (!validatorUp) { res.writeHead(500); return res.end() }
    if (token === tokenA) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, sessao: 'sessao-a-0001' })) }
    if (token === tokenB) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, sessao: 'sessao-b-0002' })) }
    res.writeHead(403); res.end()
  })
})
const vport = await free(); await new Promise(r => validator.listen(vport, '127.0.0.1', r))
async function start(extra = {}) {
  const port = await free()
  const env = { ...process.env, NODE_ENV: 'test', ADMIN_PIN: crypto.randomBytes(12).toString('hex'), PORT: String(port), PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, DATA_DIR: DATA, MIN_FREE_MB: '0', UPLOAD_CHUNK_MB: '1', MAX_FILE_MB: '8', RELAY_VALIDATE_URL: `http://127.0.0.1:${vport}/validar`, ...extra }
  const server = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  await Promise.race([new Promise((ok, no) => { server.stdout.once('data', ok); server.once('exit', c => no(new Error('Servidor encerrou: ' + c))) }), delay(10000, undefined, { ref: false }).then(() => { throw new Error('Servidor não iniciou') })])
  return { base: `http://127.0.0.1:${port}`, stop: () => new Promise(r => { server.once('exit', r); server.kill() }) }
}
let srv = await start()
const call = (url, method = 'GET', data, token = tokenA, extra = {}) => fetch(srv.base + url, { method, headers: { 'x-passagem-client': '1', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(data && !Buffer.isBuffer(data) ? { 'content-type': 'application/json' } : {}), ...extra }, body: data === undefined ? undefined : Buffer.isBuffer(data) ? data : JSON.stringify(data) })
try {
  // sem token, token errado e token em outra rota
  assert.equal((await call('/api/relay/files', 'GET', undefined, null)).status, 403, 'sem token')
  assert.equal((await call('/api/relay/files', 'GET', undefined, 'x'.repeat(32))).status, 403, 'token inválido')
  // envio em partes de 3 MB, qualquer extensão
  const data = crypto.randomBytes(3 * MB), hash = crypto.createHash('sha256').update(data).digest('hex')
  let r = await call('/api/relay/uploads', 'POST', { name: 'driver.inf', size: data.length }); assert.equal(r.status, 201)
  const up = await r.json(); assert.equal(up.chunkSize, MB)
  for (let off = 0; off < data.length; off += MB) {
    r = await call(`/api/relay/uploads/${up.id}`, 'PATCH', data.subarray(off, off + MB), tokenA, { 'content-type': 'application/octet-stream', 'upload-offset': String(off) }); assert.equal(r.status, 200)
  }
  r = await call(`/api/relay/uploads/${up.id}/complete`, 'POST'); assert.equal(r.status, 201); const file = await r.json(); assert.equal(file.name, 'driver.inf')
  // o outro lado da mesma sessão (mesmo token) lista e baixa; outra sessão não vê nada
  r = await call('/api/relay/files'); assert.deepEqual((await r.json()).files.map(f => f.name), ['driver.inf'])
  r = await call('/api/relay/files', 'GET', undefined, tokenB); assert.deepEqual((await r.json()).files, [], 'escopo por sessão')
  assert.equal((await call(`/api/relay/files/${file.id}`, 'GET', undefined, tokenB)).status, 404, 'outra sessão não baixa')
  r = await call(`/api/relay/files/${file.id}`); assert.equal(r.status, 200)
  assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'), hash, 'mesmo hash')
  r = await call(`/api/relay/files/${file.id}`, 'GET', undefined, tokenA2, { range: `bytes=${MB}-${MB + 9}` }); assert.equal(r.status, 206)
  // a sala de trânsito não aparece na API de salas nem aceita acesso por código
  assert.equal((await call('/api/relay-0000', 'GET', undefined, null)).status, 404)
  // apagar depois do download
  assert.equal((await call(`/api/relay/files/${file.id}`, 'DELETE')).status, 200)
  assert.deepEqual((await (await call('/api/relay/files')).json()).files, [], 'apagado')
  assert.equal(fs.readdirSync(DATA).filter(f => f.startsWith('relay-')).length, 0, 'sala de trânsito removida quando vazia')
  // limite de tamanho
  assert.equal((await call('/api/relay/uploads', 'POST', { name: 'grande.bin', size: 9 * MB })).status, 413)
  // validador fora do ar: falha fechada (token novo, sem cache)
  validatorUp = false; await srv.stop(); srv = await start()
  assert.equal((await call('/api/relay/files')).status, 503, 'validador fora do ar nega')
  validatorUp = true
  // sem RELAY_VALIDATE_URL a rota some
  await srv.stop(); srv = await start({ RELAY_VALIDATE_URL: '' })
  assert.equal((await call('/api/relay/files')).status, 404, 'rota desligada sem a variável')
  // expiração
  await srv.stop(); srv = await start({ RELAY_TTL_MINUTES: '1' })
  console.log('relay: ok')
} finally { await srv.stop(); validator.close(); fs.rmSync(DATA, { recursive: true, force: true }) }
