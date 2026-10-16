// Passagem: área de transferência de mão dupla por link. Sem dependências.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 3000)
const DATA = path.resolve(process.env.DATA_DIR || './data')
const PIN = process.env.ADMIN_PIN || ''
const TTL_MS = Number(process.env.ROOM_TTL_HOURS || 24) * 3600e3
const MAX_FILE = Number(process.env.MAX_FILE_MB || 500) * 1048576
const MAX_ROOM = Number(process.env.MAX_ROOM_MB || 2048) * 1048576
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'
const CODE = /^[a-z2-9]{8}$/
const ID = /^[a-f0-9]{16}$/
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }

if (!PIN) { console.error('ADMIN_PIN não definido: defina no ambiente.'); process.exit(1) }
fs.mkdirSync(DATA, { recursive: true })

const roomDir = (c) => path.join(DATA, c)
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const randCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHA[b % ALPHA.length]).join('')
const touch = (c) => { const t = new Date(); fs.utimesSync(roomDir(c), t, t) }
const alive = (c) => { try { return Date.now() - fs.statSync(roomDir(c)).mtimeMs < TTL_MS } catch { return false } }
const safeName = (n) => (String(n || 'arquivo').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200) || 'arquivo')
const roomSize = (c) => fs.readdirSync(roomDir(c)).filter((f) => f.endsWith('.bin')).reduce((s, f) => s + fs.statSync(path.join(roomDir(c), f)).size, 0)

// ponytail: limite por IP em memória (reinicia com o processo); trocar por Redis se virar multi-instância
const fails = new Map()
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
const recent = (ip) => (fails.get(ip) || []).filter((t) => Date.now() - t < 600e3)
const blocked = (ip) => recent(ip).length >= 30
const fail = (ip) => fails.set(ip, [...recent(ip), Date.now()])
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest()

function items(c) {
  return fs.readdirSync(roomDir(c)).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(roomDir(c), f), 'utf8')))
    .sort((a, b) => b.at - a.at)
}

async function api(req, res, url) {
  const ip = ipOf(req)
  const parts = url.pathname.split('/').filter(Boolean).slice(1) // tira "api"

  if (req.method === 'POST' && parts[0] === 'rooms') {
    if (blocked(ip)) return json(res, 429, { erro: 'Muitas tentativas.' })
    if (!crypto.timingSafeEqual(sha(req.headers['x-pin']), sha(PIN))) { fail(ip); return json(res, 401, { erro: 'PIN incorreto.' }) }
    let code; do code = randCode(); while (fs.existsSync(roomDir(code)))
    fs.mkdirSync(roomDir(code))
    return json(res, 201, { code })
  }

  const code = parts[0]
  if (!CODE.test(code || '')) return json(res, 404, { erro: 'Sala não encontrada.' })
  if (blocked(ip)) return json(res, 429, { erro: 'Muitas tentativas.' })
  if (!alive(code)) { fail(ip); return json(res, 404, { erro: 'Sala não encontrada ou expirada.' }) }

  const [, kind, id] = parts
  if (req.method === 'GET' && !kind) return json(res, 200, { items: items(code), ttlHours: TTL_MS / 3600e3, maxFileMb: MAX_FILE / 1048576 })

  if (req.method === 'POST' && kind === 'text') {
    let raw = ''
    for await (const ch of req) { raw += ch; if (raw.length > 1e6) return json(res, 413, { erro: 'Texto grande demais.' }) }
    const text = String(JSON.parse(raw || '{}').text || '').trim()
    if (!text) return json(res, 400, { erro: 'Texto vazio.' })
    const item = { id: crypto.randomBytes(8).toString('hex'), kind: 'text', text, at: Date.now() }
    fs.writeFileSync(path.join(roomDir(code), item.id + '.json'), JSON.stringify(item))
    touch(code)
    return json(res, 201, item)
  }

  if (req.method === 'PUT' && kind === 'file') {
    const declared = Number(req.headers['content-length'] || 0)
    if (declared > MAX_FILE) return json(res, 413, { erro: `Máximo de ${MAX_FILE / 1048576} MB por arquivo.` })
    if (roomSize(code) + declared > MAX_ROOM) return json(res, 413, { erro: 'Sala cheia.' })
    const fid = crypto.randomBytes(8).toString('hex')
    const bin = path.join(roomDir(code), fid + '.bin')
    let n = 0
    const cap = new Transform({ transform(chunk, _e, cb) { n += chunk.length; cb(n > MAX_FILE ? new Error('grande') : null, chunk) } })
    try { await pipeline(req, cap, fs.createWriteStream(bin)) } catch { fs.rmSync(bin, { force: true }); return json(res, 413, { erro: 'Arquivo grande demais.' }) }
    const item = { id: fid, kind: 'file', name: safeName(url.searchParams.get('name')), size: n, at: Date.now() }
    fs.writeFileSync(path.join(roomDir(code), fid + '.json'), JSON.stringify(item))
    touch(code)
    return json(res, 201, item)
  }

  if (ID.test(id || '')) {
    const meta = path.join(roomDir(code), id + '.json')
    if (!fs.existsSync(meta)) return json(res, 404, { erro: 'Item não encontrado.' })
    if (req.method === 'GET' && kind === 'file') {
      const it = JSON.parse(fs.readFileSync(meta, 'utf8'))
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': it.size, 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(it.name), 'x-content-type-options': 'nosniff' })
      return fs.createReadStream(path.join(roomDir(code), id + '.bin')).pipe(res)
    }
    if (req.method === 'DELETE' && kind === 'item') {
      fs.rmSync(meta, { force: true }); fs.rmSync(path.join(roomDir(code), id + '.bin'), { force: true })
      touch(code)
      return json(res, 200, { ok: true })
    }
  }
  return json(res, 404, { erro: 'Não encontrado.' })
}

function serveStatic(req, res, url) {
  let f = path.join(WEB, path.normalize(url.pathname))
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(WEB, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
  fs.createReadStream(f).pipe(res)
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url)
  api(req, res, url).catch((e) => { console.error(e); if (!res.headersSent) json(res, 500, { erro: 'Erro interno.' }); else res.destroy() })
}).listen(PORT, () => console.log(`Passagem em :${PORT}`))

setInterval(() => {
  for (const c of fs.readdirSync(DATA)) if (CODE.test(c) && !alive(c)) fs.rmSync(roomDir(c), { recursive: true, force: true })
}, 600e3)
