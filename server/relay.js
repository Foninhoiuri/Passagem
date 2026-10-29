// Transferência direta entre dois computadores: sem sala, sem PIN, sem interface. O token da sessão da ponte remota
// (que os dois lados já têm) é validado por RELAY_VALIDATE_URL; a "sessão" devolvida define o escopo dos arquivos.
// O Passagem não guarda o token: só um hash em cache por 60 s. Sem RELAY_VALIDATE_URL a rota fica desligada.
import crypto from 'node:crypto'
import { audit, body, clientKey, error, json } from './security.js'
import { cancelUpload, ensureRelay, finishUpload, items, alive, removeItem, sendFile, startUpload, uploadState, writeChunk, validId } from './storage.js'
const VALIDATE_URL = process.env.RELAY_VALIDATE_URL || ''
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex')
const cache = new Map()
const failures = new Map()
const FAIL_MAX = 5
function failed(key) {
  const now = Date.now(), f = failures.get(key)
  failures.set(key, !f || f.until < now ? { n: 1, until: now + 60000 } : { n: f.n + 1, until: f.until })
  if (failures.size > 10000) for (const [k, v] of failures) if (v.until < now) failures.delete(k)
  return error(403, 'Token não autorizado.')
}
async function scope(req) {
  if (!VALIDATE_URL) throw error(404, 'Não encontrado.')
  const key = clientKey(req), f = failures.get(key)
  if (f && f.until > Date.now() && f.n >= FAIL_MAX) throw error(429, 'Muitas tentativas. Aguarde um minuto.')
  const m = /^Bearer ([A-Za-z0-9._~-]{16,200})$/.exec(req.headers.authorization || '')
  if (!m) throw failed(key)
  const th = sha(m[1]), hit = cache.get(th)
  let sessao = hit && hit.until > Date.now() ? hit.sessao : null
  if (!sessao) {
    let r
    try { r = await fetch(VALIDATE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: m[1] }), signal: AbortSignal.timeout(5000), redirect: 'error' }) }
    catch { throw error(503, 'Validador indisponível.') } // falha fechada
    if (r.status >= 500) throw error(503, 'Validador indisponível.')
    if (r.status !== 200) throw failed(key)
    let data
    try { data = await r.json() } catch { throw failed(key) }
    if (!data || data.ok !== true || typeof data.sessao !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(data.sessao)) throw failed(key)
    sessao = data.sessao
    if (cache.size > 1000) cache.clear()
    cache.set(th, { sessao, until: Date.now() + 60000 })
  }
  return 'relay-' + sha(sessao).slice(0, 32)
}
const listed = c => alive(c) ? items(c).filter(i => i.kind === 'file').map(i => ({ id: i.id, name: i.name, size: i.size, at: i.at })) : []
export async function relay(req, res, parts) {
  const c = await scope(req)
  const [kind, id, operation] = parts
  if (kind === 'uploads' && parts.length === 1 && req.method === 'POST') {
    const data = await body(req, 2048, ['name', 'size', 'type'])
    ensureRelay(c)
    const upload = startUpload(c, data); audit(req, 'relay-upload-start', c); return json(res, 201, upload)
  }
  if (kind === 'uploads' && parts.length === 2) {
    if (!alive(c)) throw error(404, 'Envio não encontrado ou expirado.')
    if (req.method === 'GET') return json(res, 200, uploadState(c, id))
    if (req.method === 'PATCH') { const state = await writeChunk(c, id, req); audit(req, 'relay-upload-chunk', c); return json(res, 200, state) }
    if (req.method === 'DELETE') { cancelUpload(c, id); audit(req, 'relay-upload-cancel', c); return json(res, 200, { ok: true }) }
  }
  if (kind === 'uploads' && parts.length === 3 && operation === 'complete' && req.method === 'POST') {
    if (!alive(c)) throw error(404, 'Envio não encontrado ou expirado.')
    const item = finishUpload(c, id); audit(req, 'relay-file-create', c); return json(res, 201, { id: item.id, name: item.name, size: item.size })
  }
  if (kind === 'files' && parts.length === 1 && req.method === 'GET') return json(res, 200, { files: listed(c) })
  if (kind === 'files' && parts.length === 2 && validId(id)) {
    if (!alive(c)) throw error(404, 'Arquivo não encontrado.')
    if (['GET', 'HEAD'].includes(req.method)) { audit(req, 'relay-file-download', c); return sendFile(req, res, c, id) }
    if (req.method === 'DELETE') { removeItem(c, id); audit(req, 'relay-file-delete', c); return json(res, 200, { ok: true }) }
  }
  throw error(404, 'Não encontrado.')
}
