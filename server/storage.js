import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { DATA, error, audit } from './security.js'
const MB = 1048576
function setting(name, fallback, min = 1) { const n = Number(process.env[name] || fallback); if (!Number.isFinite(n) || n < min) throw new Error(name + ' inválido.'); return n }
export const limits = { maxFileMb: setting('MAX_FILE_MB', 5120), maxRoomMb: setting('MAX_ROOM_MB', 8192), maxTotalMb: setting('MAX_TOTAL_MB', 12288), chunkSize: setting('UPLOAD_CHUNK_MB', 8) * MB }
if (limits.chunkSize > 16 * MB) throw new Error('UPLOAD_CHUNK_MB deve ser no máximo 16.')
const reserve = setting('MIN_FREE_MB', 2048, 0) * MB
export const ttlMs = setting('ROOM_TTL_HOURS', 24) * 3600e3
export const relayTtlMs = setting('RELAY_TTL_MINUTES', 60) * 60e3 // transferência direta: só trânsito, some em 1 h
const maxRooms = setting('MAX_ROOMS', 300)
const pendingTtl = setting('UPLOAD_TTL_HOURS', 6) * 3600e3
export const isRelay = c => /^relay-[a-f0-9]{32}$/.test(c || '')
export const validRoom = c => c === '1' || /^[A-Za-z0-9_-]{32}$/.test(c) || /^[a-z2-9]{8}$/.test(c) || isRelay(c)
const ttlOf = c => isRelay(c) ? relayTtlMs : ttlMs
const relayRooms = () => fs.readdirSync(DATA).filter(isRelay)
export const validId = id => /^[a-f0-9]{16}(?:[a-f0-9]{16})?$/.test(id || '')
export const roomDir = c => { if (!validRoom(c)) throw error(404, 'Sala não encontrada.'); return path.join(DATA, c) }
export function atomic(file, data) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(tmp, file) }
export const touch = c => { const now = new Date(); fs.utimesSync(roomDir(c), now, now) }
export const alive = c => { try { return fs.statSync(roomDir(c)).isDirectory() } catch { return false } }
fs.mkdirSync(roomDir('1'), { recursive: true, mode: 0o700 })
function roomInfo(c) {
  const file = path.join(roomDir(c), '.room.json')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e; return { createdAt: fs.statSync(roomDir(c)).birthtimeMs || fs.statSync(roomDir(c)).mtimeMs, hadItems: items(c).length > 0 } }
}
function markUsed(c) { if (c !== '1') atomic(path.join(roomDir(c), '.room.json'), { ...roomInfo(c), hadItems: true }) }
export function rooms() {
  const all = fs.readdirSync(DATA).filter(c => c !== '1' && validRoom(c) && !isRelay(c) && alive(c))
  for (const c of all) cleanupRoom(c)
  return all.filter(alive).map(code => { const list = items(code); return { code, itemCount: list.length, expiresAt: list.length ? Math.max(...list.map(i => i.at + ttlMs)) : roomInfo(code).createdAt + ttlMs } }).sort((a,b) => b.expiresAt-a.expiresAt)
}
export function ensureRelay(c) { if (!isRelay(c)) throw error(404, 'Não encontrado.'); fs.mkdirSync(roomDir(c), { recursive: true, mode: 0o700 }) }
export function createRoom() {
  if (rooms().length >= maxRooms) throw error(409, 'Limite de salas atingido no momento. Tente novamente mais tarde.')
  const code = crypto.randomBytes(24).toString('base64url'); fs.mkdirSync(roomDir(code), { mode: 0o700 }); atomic(path.join(roomDir(code), '.room.json'), { createdAt: Date.now(), hadItems: false }); return code
}
export function items(c) {
  return fs.readdirSync(roomDir(c)).filter(f => /^[a-f0-9]{16}(?:[a-f0-9]{16})?\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(roomDir(c), f), 'utf8'))).map(i=>({...i,expiresAt:i.at+ttlMs})).sort((a, b) => b.at - a.at)
}
const upDir = c => path.join(roomDir(c), '.uploads')
const upMeta = (c, id) => path.join(upDir(c), id + '.json')
const part = (c, id) => path.join(upDir(c), id + '.part')
const bin = (c, id) => path.join(roomDir(c), id + '.bin')
const fileMeta = (c, id) => path.join(roomDir(c), id + '.json')
const safeName = n => String(n || '').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').slice(0, 200)
const MIME = {
  png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], gif: ['image/gif'], webp: ['image/webp'], avif: ['image/avif'], heic: ['image/heic','image/heif'], heif: ['image/heif','image/heic'], bmp: ['image/bmp'], tif: ['image/tiff'], tiff: ['image/tiff'],
  pdf: ['application/pdf'], txt: ['text/plain'], md: ['text/markdown','text/plain'], csv: ['text/csv','application/vnd.ms-excel'], tsv: ['text/tab-separated-values','text/plain'], json: ['application/json','text/plain'], yaml: ['application/yaml','text/yaml','text/plain'], yml: ['application/yaml','text/yaml','text/plain'], xml: ['application/xml','text/xml','text/plain'],
  doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ppt: ['application/vnd.ms-powerpoint'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], odt: ['application/vnd.oasis.opendocument.text'], ods: ['application/vnd.oasis.opendocument.spreadsheet'], rtf: ['application/rtf','text/rtf'],
  zip: ['application/zip','application/x-zip-compressed'], '7z': ['application/x-7z-compressed'], rar: ['application/vnd.rar','application/x-rar-compressed'], tar: ['application/x-tar'], gz: ['application/gzip','application/x-gzip'], bz2: ['application/x-bzip2'], xz: ['application/x-xz'], iso: ['application/x-iso9660-image'],
  mp4: ['video/mp4'], mov: ['video/quicktime'], webm: ['video/webm','audio/webm'], mkv: ['video/x-matroska'], avi: ['video/x-msvideo'], mp3: ['audio/mpeg'], wav: ['audio/wav','audio/x-wav'], m4a: ['audio/mp4','audio/x-m4a'], ogg: ['audio/ogg','video/ogg','application/ogg'], flac: ['audio/flac','audio/x-flac'],
}
for (const ext of ['js','jsx','ts','tsx','py','sql','sh','bash','ps1','bat','cmd','css','html','htm','c','h','cpp','hpp','java','go','rs','log','ini','cfg','conf','toml','properties']) MIME[ext] = ['text/plain', 'application/javascript', 'text/javascript', 'text/html', 'text/css', 'application/x-sh', 'application/x-python-code', 'video/mp2t']
for (const ext of ['exe','msi','dll','apk','dmg','bin','dat','db','sqlite','bak']) MIME[ext] = ['application/x-msdownload','application/x-msdos-program','application/vnd.microsoft.portable-executable','application/vnd.android.package-archive','application/x-apple-diskimage','application/x-sqlite3','application/macbinary','application/x-macbinary','application/binary','application/x-msi']
function validateFile(name, type) {
  if (typeof name !== 'string' || !name || name.length > 500 || typeof type !== 'string' || type.length > 150) throw error(400, 'Nome ou tipo de arquivo inválido.')
  const ext = name.split('.').pop().toLowerCase(), allowed = MIME[ext]
  if (!allowed || (type && type !== 'application/octet-stream' && !allowed.includes(type.toLowerCase()))) throw error(415, 'Tipo de arquivo não permitido. Para compartilhar código, use o campo de texto ou um arquivo ZIP.')
  return safeName(name)
}
function signature(file, name, size) {
  if (!size) return
  const fd = fs.openSync(file, 'r'), b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd)
  const ext = name.split('.').pop().toLowerCase()
  const rules = { png: b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')), jpg: b[0] === 255 && b[1] === 216, jpeg: b[0] === 255 && b[1] === 216, gif: /^GIF8[79]a/.test(b.toString('ascii')), webp: b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP', pdf: b.toString('ascii',0,5) === '%PDF-', zip: b[0] === 80 && b[1] === 75 }
  if (Object.hasOwn(rules, ext) && !rules[ext]) throw error(415, 'O conteúdo do arquivo não corresponde ao formato informado.')
}
const pending = c => fs.existsSync(upDir(c)) ? fs.readdirSync(upDir(c)).filter(f => /^[a-f0-9]{32}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(upDir(c), f), 'utf8'))) : []
function usage(c) {
  const completed = items(c).reduce((n, i) => n + (i.kind === 'file' ? i.size : Buffer.byteLength(i.text || '')), 0)
  const uploads = pending(c)
  return { reserved: completed + uploads.reduce((n,u) => n + u.size, 0), remaining: uploads.reduce((n,u) => n + Math.max(0, u.size - u.offset), 0), count: items(c).length + uploads.length }
}
export function capacity(c, size) {
  const current = usage(c)
  if (current.count >= 1000) throw error(409, 'Limite de itens da sala atingido. Remova itens para continuar.')
  if (current.reserved + size > limits.maxRoomMb * MB) throw error(413, 'Esta sala não tem espaço para este arquivo.')
  const all = ['1', ...rooms().map(r => r.code), ...relayRooms()].map(usage)
  if (all.reduce((n,u) => n + u.reserved, 0) + size > limits.maxTotalMb * MB) throw error(507, 'O armazenamento total atingiu o limite. Remova arquivos antes de enviar mais.')
  const disk = fs.statfsSync(DATA), available = disk.bavail * disk.bsize
  if (available - all.reduce((n,u) => n + u.remaining, 0) - size < reserve) throw error(507, 'Espaço livre insuficiente para enviar este arquivo com segurança.')
}
const relayName = n => { if (typeof n !== 'string' || !n.trim() || n.length > 500) throw error(400, 'Nome de arquivo inválido.'); return safeName(n) || 'arquivo' }
export function startUpload(c, data) {
  // transferência direta aceita qualquer tipo (instaladores, drivers): só trânsito, nunca servido como página
  const name = isRelay(c) ? relayName(data.name) : validateFile(data.name, data.type)
  if (!Number.isSafeInteger(data.size) || data.size < 0 || data.size > limits.maxFileMb * MB) throw error(413, `Máximo de ${limits.maxFileMb} MB por arquivo.`)
  capacity(c, data.size); fs.mkdirSync(upDir(c), { recursive: true, mode: 0o700 })
  const id = crypto.randomBytes(16).toString('hex'), meta = { id, name, type: data.type, size: data.size, offset: 0, updatedAt: Date.now() }
  fs.closeSync(fs.openSync(part(c, id), 'wx', 0o600)); atomic(upMeta(c, id), meta); touch(c)
  return { id, offset: 0, chunkSize: limits.chunkSize, size: data.size }
}
export function uploadState(c, id) {
  if (!validId(id)) throw error(404, 'Envio não encontrado.')
  if (fs.existsSync(fileMeta(c,id))) return { complete: true, item: JSON.parse(fs.readFileSync(fileMeta(c,id),'utf8')) }
  if (!fs.existsSync(upMeta(c,id))) throw error(404, 'Envio não encontrado ou expirado.')
  const m = JSON.parse(fs.readFileSync(upMeta(c,id), 'utf8')); return { ...m, chunkSize: limits.chunkSize }
}
const active = new Set()
function lock(c, id) { const key = c + ':' + id; if (active.has(key)) throw error(409, 'Este envio já está sendo processado. Tente novamente.'); active.add(key); return () => active.delete(key) }
export async function writeChunk(c, id, req) {
  const unlock = lock(c,id)
  try {
    if (req.headers['content-type'] !== 'application/octet-stream') throw error(415, 'Formato de parte inválido.')
    const meta = uploadState(c,id)
    if (meta.complete) return meta
    const offset = Number(req.headers['upload-offset'])
    if (!/^\d+$/.test(String(req.headers['upload-offset'] || '')) || offset !== meta.offset) throw error(409, 'A posição do envio mudou. Retome o envio para continuar.')
    const max = Math.min(limits.chunkSize, meta.size - offset), declared = Number(req.headers['content-length'])
    if (max <= 0) throw error(409, 'O arquivo já foi recebido. Finalize o envio.')
    if (!Number.isSafeInteger(declared) || declared <= 0 || declared > max) throw error(413, 'Parte do arquivo acima do limite permitido.')
    const disk = fs.statfsSync(DATA); if (disk.bavail * disk.bsize < reserve + declared) throw error(507, 'Espaço livre insuficiente.')
    fs.truncateSync(part(c,id), offset)
    let bytes = 0
    const cap = new Transform({ transform(chunk, _e, done) { bytes += chunk.length; done(bytes > declared ? error(413, 'Parte do arquivo acima do limite.') : null, chunk) } })
    try { await pipeline(req, cap, fs.createWriteStream(part(c,id), { flags: 'r+', start: offset })) }
    catch (e) { if (fs.existsSync(part(c,id))) fs.truncateSync(part(c,id), offset); throw e.status ? e : error(400, 'A conexão foi interrompida. Retome o envio.') }
    if (bytes !== declared) { fs.truncateSync(part(c,id), offset); throw error(400, 'Parte incompleta. Retome o envio.') }
    meta.offset += bytes; meta.updatedAt = Date.now(); delete meta.chunkSize
    atomic(upMeta(c,id),meta); touch(c)
    return { id, offset: meta.offset, size: meta.size, chunkSize: limits.chunkSize }
  } finally { unlock() }
}
export function finishUpload(c,id) {
  const unlock = lock(c,id)
  try {
    const meta = uploadState(c,id); if (meta.complete) return meta.item
    if (meta.offset !== meta.size) throw error(409, 'O envio ainda não terminou.')
    const source = fs.existsSync(part(c,id)) ? part(c,id) : bin(c,id)
    if (!fs.existsSync(source) || fs.statSync(source).size !== meta.size) throw error(409, 'Arquivo incompleto. Retome o envio.')
    signature(source,meta.name,meta.size)
    if (source !== bin(c,id)) fs.renameSync(source,bin(c,id))
    const item = { id, kind: 'file', name: meta.name, size: meta.size, at: Date.now() }
    atomic(fileMeta(c,id),item); markUsed(c); fs.rmSync(upMeta(c,id), { force: true }); touch(c); return item
  } finally { unlock() }
}
export function cancelUpload(c,id) { if (!validId(id)) throw error(404,'Envio não encontrado.'); const unlock = lock(c,id); try { fs.rmSync(part(c,id),{force:true});fs.rmSync(upMeta(c,id),{force:true});touch(c) } finally { unlock() } }
export function getFile(c,id) { if (!validId(id) || !fs.existsSync(fileMeta(c,id))) throw error(404,'Arquivo não encontrado.');const item=JSON.parse(fs.readFileSync(fileMeta(c,id),'utf8'));if(item.kind!=='file'||!fs.existsSync(bin(c,id)))throw error(404,'Arquivo não encontrado.');return {item,file:bin(c,id)} }
export function removeItem(c,id) {
  if (!validId(id) || !fs.existsSync(fileMeta(c,id))) throw error(404,'Item não encontrado.')
  markUsed(c)
  fs.rmSync(bin(c,id),{force:true}); fs.rmSync(path.join(roomDir(c),'.thumb-'+id+'.webp'),{force:true}); fs.rmSync(fileMeta(c,id)); touch(c)
  cleanupRoom(c)
  return !alive(c)
}
export function addText(c,text) {
  if(typeof text!=='string'||!text.trim())throw error(400,'Texto vazio.')
  capacity(c,Buffer.byteLength(text))
  const item={id:crypto.randomBytes(16).toString('hex'),kind:'text',text,at:Date.now()}
  atomic(fileMeta(c,item.id),item);markUsed(c);touch(c);return item
}
export function closeRoom(c) { if(c==='1')throw error(400,'A sala privada não pode ser encerrada.');if([...active].some(key=>key.startsWith(c+':')))throw error(409,'Aguarde o envio em andamento antes de encerrar a sala.');fs.rmSync(roomDir(c),{recursive:true,force:true}) }
export function cleanupRoom(c) {
  if(!alive(c))return
  const before=items(c), info=c==='1'?null:roomInfo(c)
  if(before.length && info && !info.hadItems)markUsed(c)
  for(const it of before)if(Date.now()-it.at>=ttlOf(c)){
    fs.rmSync(bin(c,it.id),{force:true});fs.rmSync(path.join(roomDir(c),'.thumb-'+it.id+'.webp'),{force:true});fs.rmSync(fileMeta(c,it.id),{force:true});audit(null,'item-expire',c)
  }
  for(const m of pending(c))if(Date.now()-m.updatedAt>pendingTtl&&!active.has(c+':'+m.id)){
    cancelUpload(c,m.id);audit(null,'upload-expire',c)
  }
  if(c!=='1'&&!items(c).length&&!pending(c).length&&![...active].some(k=>k.startsWith(c+':'))){
    const info=roomInfo(c)
    if(info.hadItems||Date.now()-info.createdAt>=ttlOf(c)){fs.rmSync(roomDir(c),{recursive:true,force:true});audit(null,'empty-room-expire',c)}
  }
}
export function cleanup() { for(const c of fs.readdirSync(DATA).filter(validRoom))cleanupRoom(c) }
export function sendFile(req,res,c,id) {
  const {item,file}=getFile(c,id);const size=fs.statSync(file).size
  let start=0,end=size-1,status=200
  if(req.headers.range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if(!m||(!m[1]&&!m[2])){res.setHeader('Content-Range',`bytes */${size}`);throw error(416,'Faixa de download inválida.')}
    if(m[1]){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1}else{start=Math.max(0,size-Number(m[2]))}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start){res.setHeader('Content-Range',`bytes */${size}`);throw error(416,'Faixa de download inválida.')}
    status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`)
  }
  const name=safeName(item.name)||'arquivo'
  res.writeHead(status,{'Content-Type':'application/octet-stream','Content-Length':size===0?0:end-start+1,'Accept-Ranges':'bytes','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)})
  if(req.method==='HEAD'||size===0)return res.end()
  const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res)
}
