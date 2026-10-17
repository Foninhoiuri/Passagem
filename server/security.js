import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import net from 'node:net'
import { promisify } from 'node:util'
const scrypt = promisify(crypto.scrypt)
export const DATA = path.resolve(process.env.DATA_DIR || './data')
export const PRODUCTION = process.env.NODE_ENV === 'production'
export const ORIGIN = process.env.PUBLIC_ORIGIN || 'http://localhost:3000'
const originUrl = new URL(ORIGIN)
const pin = process.env.ADMIN_PIN || ''
if (pin.length < 4 || pin.length > 128 || /^(change.?me|example|password)$/i.test(pin)) throw new Error('Defina ADMIN_PIN válido no ambiente (4 a 128 caracteres).')
if (PRODUCTION && originUrl.protocol !== 'https:') throw new Error('PUBLIC_ORIGIN deve usar HTTPS em produção.')
if (!['http:', 'https:'].includes(originUrl.protocol)) throw new Error('PUBLIC_ORIGIN inválido.')
const SEC = path.join(DATA, '.security')
fs.mkdirSync(SEC, { recursive: true, mode: 0o700 })
const statePath = path.join(SEC, 'login.json')
let failures = {}
try { failures = JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
const saltPath = path.join(SEC, 'salt')
let salt
try { salt = fs.readFileSync(saltPath) } catch (e) { if (e.code !== 'ENOENT') throw e; salt = crypto.randomBytes(32); fs.writeFileSync(saltPath, salt, { mode: 0o600, flag: 'wx' }) }
const expected = await scrypt(pin, salt, 32)
const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex')
const sessions = new Map()
const globalRequests = new Map()
const trusted = new net.BlockList()
for (const cidr of (process.env.TRUST_PROXY_CIDRS || '').split(',').filter(Boolean)) {
  const [ip, prefix] = cidr.trim().split('/'); if (!net.isIPv4(ip) || !/^\d+$/.test(prefix || '') || Number(prefix) > 32) throw new Error('TRUST_PROXY_CIDRS inválido.')
  trusted.addSubnet(ip, Number(prefix), 'ipv4')
}
const peer = req => (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
export const trustedProxy = req => net.isIPv4(peer(req)) && trusted.check(peer(req), 'ipv4')
const ip = req => trustedProxy(req) && net.isIP(req.headers['cf-connecting-ip'] || '') ? req.headers['cf-connecting-ip'] : peer(req)
const clientKey = req => sha(salt.toString('hex') + ip(req))
const WINDOW = 15 * 60e3
const MAX_FAILURES = Number(process.env.LOGIN_MAX_ATTEMPTS || 5)
const ACCOUNT_MAX = Number(process.env.LOGIN_ACCOUNT_ATTEMPTS || 20)
const SESSION_MS = Number(process.env.SESSION_HOURS || 8) * 3600e3
if (![MAX_FAILURES, ACCOUNT_MAX, SESSION_MS].every(n => Number.isFinite(n) && n > 0)) throw new Error('Limites de autenticação inválidos.')
const cookieName = originUrl.protocol === 'https:' ? '__Host-passagem' : 'passagem_dev'
const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${originUrl.protocol === 'https:' ? '; Secure' : ''}`
const recent = key => (failures[key] || []).filter(t => Date.now() - t < WINDOW)
function saveFailures() {
  failures = Object.fromEntries(Object.keys(failures).map(k => [k, recent(k)]).filter(([, v]) => v.length))
  // Bound state even if many client addresses are used.
  if (Object.keys(failures).length > 10000) failures = { account: recent('account') }
  const temp = statePath + '.tmp'; fs.writeFileSync(temp, JSON.stringify(failures), { mode: 0o600 }); fs.renameSync(temp, statePath)
}
let auditHash = ''
const auditPath = path.join(SEC, 'audit.jsonl')
try {
 const fd=fs.openSync(auditPath,'r');try{const size=fs.fstatSync(fd).size,buffer=Buffer.alloc(Math.min(size,8192));fs.readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));const last=buffer.toString('utf8').trim().split('\n').pop();auditHash=last?JSON.parse(last).hash:''}finally{fs.closeSync(fd)}
} catch(e){if(e.code!=='ENOENT')throw e}
const auditThrottle=new Map()

export function audit(req, action, room = '', outcome = 'ok') {
  if (outcome === 'denied' || outcome === 'blocked') {
    const key = (req ? clientKey(req) : 'system') + ':' + action + ':' + outcome
    const previous = auditThrottle.get(key)
    if (previous && Date.now() - previous < 60000) return
    if (auditThrottle.size >= 10000) auditThrottle.clear()
    auditThrottle.set(key, Date.now())
  }
  // Room links are bearer credentials: only a hash, never the link, name, content or PIN.
  const event = { at: new Date().toISOString(), action, outcome, actor: req ? (session(req) ? 'owner' : 'guest') : 'system', origin: req ? clientKey(req).slice(0, 16) : 'system', room: room ? sha(room).slice(0, 16) : '', prev: auditHash }
  const hash = sha(JSON.stringify(event)); fs.appendFileSync(auditPath, JSON.stringify({ ...event, hash }) + '\n', { mode: 0o600 }); auditHash = hash
}
export function json(res, status, body, extra = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(body)) }
export function error(status, message) { return Object.assign(new Error(message), { status }) }
export async function body(req, max = 1024 * 1024, keys) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw error(415, 'Envie os dados como JSON.')
  let size = 0; const chunks = []
  for await (const c of req) { size += c.length; if (size > max) throw error(413, 'Conteúdo acima do limite.'); chunks.push(c) }
  let data
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw error(400, 'Dados inválidos.') }
  if (!data || Array.isArray(data) || typeof data !== 'object' || (keys && Object.keys(data).some(k => !keys.includes(k)))) throw error(400, 'Campos inválidos.')
  return data
}
export function session(req) {
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null
  const key = sha(raw), value = sessions.get(key)
  if (!value) return null
  if (Date.now() > value.expires) { sessions.delete(key); return null }
  return { ...value, key }
}
export function requireOwner(req) { const s = session(req); if (!s) throw error(401, 'Entre na sua sala privada para continuar.'); return s }
export function requireCsrf(req) {
  const s = requireOwner(req), supplied = String(req.headers['x-csrf-token'] || '')
  if (!/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== s.csrf.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(s.csrf))) throw error(403, 'Atualize a página para confirmar esta ação.')
}
export const isPublicIcon = pathname => /^(?:\/apple-touch-icon(?:-v3|-precomposed|-180x180)?\.png|\/icons\/passagem-v[23]-(?:32|48|120|152|167|180|192|512|maskable-512)\.png)$/.test(pathname)
export function guard(req, res, url) {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader(process.env.CSP_REPORT_ONLY === 'true' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; manifest-src 'self'; worker-src 'self'")
  if (originUrl.protocol === 'https:') res.setHeader('Strict-Transport-Security', 'max-age=31536000')
  if (PRODUCTION && (!trustedProxy(req) || req.headers['x-forwarded-proto'] !== 'https')) {
    res.writeHead(308, { Location: ORIGIN + url.pathname + url.search }); res.end(); return false
  }
  const origin = req.headers.origin
  const publicIconRead = ['GET', 'HEAD'].includes(req.method) && isPublicIcon(url.pathname)
  if (origin && origin !== originUrl.origin && !publicIconRead) throw error(403, 'Origem não permitida.')
  if (req.headers['sec-fetch-site'] === 'cross-site' && !['GET', 'HEAD'].includes(req.method)) throw error(403, 'Origem não permitida.')
  const now = Date.now(), key = clientKey(req)
  if (globalRequests.size > 10000) for (const [k, v] of globalRequests) if (v.until < now) globalRequests.delete(k)
  const count = globalRequests.get(key)
  if (!count && globalRequests.size >= 10000) throw error(429, 'Muitas conexões. Tente novamente em um minuto.')
  if (!count || count.until < now) globalRequests.set(key, { n: 1, until: now + 60000 })
  else if (++count.n > 1200) { res.setHeader('Retry-After', '60'); throw error(429, 'Muitas requisições. Aguarde um minuto.') }
  if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && url.pathname !== '/api/login') {
    if (session(req)) requireCsrf(req)
    else if (req.headers['x-passagem-client'] !== '1') throw error(403, 'Atualize a página para continuar.')
  }
  return true
}
const loginPending = new Map()
let accountPending = 0
export async function login(req, res) {
  const key = clientKey(req), client = recent(key), account = recent('account')
  if (client.length + (loginPending.get(key) || 0) >= MAX_FAILURES || account.length + accountPending >= ACCOUNT_MAX) {
    const oldest = (client.length >= MAX_FAILURES ? client[0] : account[0]) || Date.now()
    const retry = Math.max(1, Math.ceil((oldest + WINDOW - Date.now()) / 1000))
    audit(req, 'login', '', 'blocked'); return json(res, 429, { erro: 'Limite de tentativas atingido. Aguarde antes de tentar novamente.', retryAfter: retry }, { 'Retry-After': String(retry) })
  }
  loginPending.set(key, (loginPending.get(key) || 0) + 1); accountPending++
  try {
  const { pin: supplied } = await body(req, 1024, ['pin'])
  const candidate = typeof supplied === 'string' && supplied.length <= 128 ? supplied : ''
  const actual = await scrypt(candidate, salt, 32)
  if (!crypto.timingSafeEqual(expected, actual)) {
    failures[key] = [...recent(key), Date.now()]; failures.account = [...recent('account'), Date.now()]; saveFailures(); audit(req, 'login', '', 'denied')
    return json(res, 401, { erro: 'Senha incorreta.', attemptsRemaining: Math.max(0, MAX_FAILURES - failures[key].length) })
  }
  failures[key] = []; saveFailures()
  for (const [k, value] of sessions) if (value.expires < Date.now()) sessions.delete(k)
  if (sessions.size >= 20) sessions.delete(sessions.keys().next().value)
  const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(32).toString('hex')
  sessions.set(sha(token), { csrf, expires: Date.now() + SESSION_MS })
  audit(req, 'login', '', 'ok')
  return json(res, 200, { isAdmin: true, csrfToken: csrf }, { 'Set-Cookie': cookie(token, Math.floor(SESSION_MS / 1000)) })
  } finally { const n = (loginPending.get(key) || 1) - 1; if(n)loginPending.set(key,n);else loginPending.delete(key); accountPending-- }
}
export function logout(req, res) { const s = requireOwner(req); audit(req, 'logout'); sessions.delete(s.key); return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }) }
export function securityError(req, res, e) {
  if (res.headersSent) { res.destroy(); return }
  const protocol = crypto.randomUUID()
  const status = e.status || (e.code === 'ENOSPC' ? 507 : 500)
  if (status >= 500) console.error(JSON.stringify({ protocol, status, code: e.code || 'internal' }))
  try { if (!['GET', 'HEAD'].includes(req.method)) audit(req, 'write', '', 'denied') } catch { /* Do not mask the original failure. */ }
  json(res, status, { erro: e.status ? e.message : status === 507 ? 'Armazenamento sem espaço disponível.' : 'Não foi possível concluir a operação.', protocol })
}
