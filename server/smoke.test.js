// Teste de fumaça: sobe o servidor numa porta livre e exercita sala, texto, arquivo, limite e segurança.
// Uso: node server/smoke.test.js
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

const PORT = 3111
const B = `http://localhost:${PORT}`
const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, ADMIN_PIN: 'teste123', PORT, MAX_FILE_MB: '1', DATA_DIR: path.join(os.tmpdir(), 'passagem-teste-' + Date.now()) },
  stdio: 'inherit',
})
await new Promise((r) => setTimeout(r, 1000))

try {
  let r = await fetch(`${B}/api/rooms`, { method: 'POST', headers: { 'x-pin': 'errado' } })
  assert.equal(r.status, 401, 'PIN errado deve dar 401')

  r = await fetch(`${B}/api/rooms`, { method: 'POST', headers: { 'x-pin': 'teste123' } })
  assert.equal(r.status, 201)
  const { code } = await r.json()
  assert.match(code, /^[a-z2-9]{8}$/)

  r = await fetch(`${B}/api/${code}/file?name=${encodeURIComponent('foto ç.txt')}`, { method: 'PUT', body: 'conteudo' })
  assert.equal(r.status, 201)
  const file = await r.json()

  r = await fetch(`${B}/api/${code}/text`, { method: 'POST', body: JSON.stringify({ text: 'oi' }) })
  assert.equal(r.status, 201)

  const list = await (await fetch(`${B}/api/${code}`)).json()
  assert.equal(list.items.length, 2)

  r = await fetch(`${B}/api/${code}/file/${file.id}`)
  assert.equal(await r.text(), 'conteudo')
  assert.match(r.headers.get('content-disposition'), /attachment/)

  r = await fetch(`${B}/api/${code}/file?name=big`, { method: 'PUT', body: Buffer.alloc(2 * 1048576) })
  assert.equal(r.status, 413, 'arquivo acima do limite')

  r = await fetch(`${B}/api/${code}/file?name=../../x`, { method: 'PUT', body: 'x' })
  assert.equal((await r.json()).name, '.._.._x', 'nome saneado')

  assert.equal((await fetch(`${B}/api/aaaaaaaa`)).status, 404, 'sala inexistente')
  assert.equal((await fetch(`${B}/api/..%2f..%2fetc`)).status, 404, 'traversal')

  r = await fetch(`${B}/api/${code}/item/${file.id}`, { method: 'DELETE' })
  assert.equal((await (await fetch(`${B}/api/${code}`)).json()).items.length, 2) // 3 criados - 1 apagado
  console.log('OK: tudo passou')
} finally {
  srv.kill()
}
