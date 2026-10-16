import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy01, Download01, Link01, Plus, Send01, Trash01, UploadCloud01 } from '@untitledui/icons'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { UploadZone } from '@/components/UploadZone'
import { Markdown } from '@/components/Markdown'
import { copy } from '@/utils/clipboard'
import './App.css'

type Item = { id: string; kind: 'text' | 'file'; name?: string; size?: number; text?: string; at: number }
type Room = { items: Item[]; ttlHours: number; maxFileMb: number }
const code = location.pathname.slice(1).split('/')[0]
const fmtSize = (n = 0) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
const fmtTime = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
async function api(path: string, options?: RequestInit) {
  const r = await fetch(path, options)
  let data
  try { data = await r.json() } catch { throw new Error('O servidor não respondeu como esperado. Tente novamente.') }
  if (!r.ok) throw new Error(data.erro || 'Não foi possível concluir. Tente novamente.')
  return data
}
const message = (e: unknown) => e instanceof Error ? e.message : 'Sem conexão. Tente novamente.'

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <header className="flex items-center gap-3"><a href="/" aria-label="Passagem, início" className="flex size-11 items-center justify-center rounded-xl bg-brand-solid text-white"><UploadCloud01 className="size-6" /></a>
      <div><h1 className="text-xl font-semibold text-primary">Passagem</h1><p className="text-sm text-tertiary">Uma ponte entre suas telas.</p></div></header>
    {children}
  </main>
}
function Home() {
  const [pin, setPin] = useState(() => localStorage.getItem('pin') ?? '')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (busy || !pin) return
    setBusy(true); setErro('')
    try {
      const j = await api('/api/rooms', { method: 'POST', headers: { 'x-pin': pin } })
      localStorage.setItem('pin', pin); location.href = '/' + j.code
    } catch (e) { setErro(message(e)) } finally { setBusy(false) }
  }
  return <Shell><form onSubmit={e => { e.preventDefault(); void create() }} className="panel space-y-5">
    <div><h2 className="text-lg font-semibold text-primary">Abra uma sala. Compartilhe o link.</h2><p className="mt-2 text-md text-tertiary">Envie arquivos, fotos, textos e comandos entre o celular e qualquer computador.</p></div>
    <Input label="PIN" type="password" value={pin} onChange={setPin} isInvalid={!!erro} hint={erro} />
    <Button type="submit" size="lg" iconLeading={Plus} isLoading={busy} isDisabled={!pin}>Nova sala</Button>
  </form></Shell>
}
function ImagePreview({ item }: { item: Item }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const abort = new AbortController(); let objectUrl = ''
    fetch(`/api/${code}/file/${item.id}`, { signal: abort.signal }).then(async r => {
      if (!r.ok) return
      const blob = await r.blob()
      if (abort.signal.aborted) return
      // The endpoint stays attachment-only; only raster bytes are previewed as an isolated blob.
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' :
        String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8') ? 'image/gif' : String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? 'image/webp' : ''
      if (!mime || abort.signal.aborted) return
      objectUrl = URL.createObjectURL(new Blob([blob], { type: mime })); setUrl(objectUrl)
    }).catch(() => {})
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item.id])
  return url ? <img src={url} alt={item.name} loading="lazy" className="received-image" /> : null
}
function RoomView() {
  const [room, setRoom] = useState<Room | null>(null)
  const [erro, setErro] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'markdown' | 'code' | 'command'>('markdown')
  const [language, setLanguage] = useState('bash')
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState('')
  const [removing, setRemoving] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    try { setRoom(await api(`/api/${code}`)); setErro('') } catch (e) { setErro(message(e)) } finally { setLoaded(true) }
  }, [])
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load() }, 4000); return () => clearInterval(t) }, [load])
  const formatted = () => {
    if (mode === 'markdown') return text
    const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) || []).map(s => s.length + 1)))
    return `${fence}${language}\n${text.replace(/\n$/, '')}\n${fence}`
  }
  const sendText = async () => {
    if (!text.trim() || sending) return
    setSending(true); setErro('')
    try { await api(`/api/${code}/text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: formatted() }) }); setText(''); setTab('write'); await load() }
    catch (e) { setErro(message(e)) } finally { setSending(false) }
  }
  const remove = async (id: string) => {
    setRemoving(id)
    try { await api(`/api/${code}/item/${id}`, { method: 'DELETE' }); await load() } catch (e) { setErro(message(e)) } finally { setRemoving('') }
  }
  const flash = async (id: string, value: string) => {
    try { await copy(value); setCopied(id); setTimeout(() => setCopied(''), 1500) } catch (e) { setErro(message(e)) }
  }
  if (!room) return <Shell>{!loaded ? <p role="status" className="text-tertiary">Abrindo sala…</p> : <><p role="alert" className="text-error-primary">{erro}</p><Button color="secondary" href="/">Criar outra sala</Button></>}</Shell>
  return <Shell>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary p-3">
      <div className="min-w-0"><p className="text-xs text-tertiary">Link desta sala</p><p className="break-all text-sm text-primary">{location.host}/<b>{code}</b></p></div>
      <Button size="sm" color="secondary" iconLeading={copied === 'link' ? Check : Link01} onClick={() => flash('link', location.href)}>Copiar link</Button>
    </div>
    <div className="panel"><UploadZone code={code} maxFileMb={room.maxFileMb} onComplete={load} /></div>
    <section className="panel space-y-4" aria-labelledby="text-title">
      <div><h2 id="text-title" className="text-md font-semibold text-primary">Texto, código e comandos</h2><p className="text-sm text-tertiary">Cole, formate e copie do outro lado.</p></div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="segmented" role="group" aria-label="Tipo de conteúdo">{([['markdown', 'Markdown'], ['code', 'Código'], ['command', 'Comando']] as const).map(([value, label]) =>
          <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); if (value === 'command') setLanguage('powershell') }}>{label}</button>)}</div>
        {mode !== 'markdown' && <label className="flex items-center gap-2 text-xs text-tertiary">Linguagem<select aria-label="Linguagem do código" value={language} onChange={e => setLanguage(e.target.value)} className="language-select">
          {['bash', 'powershell', 'javascript', 'typescript', 'python', 'json', 'sql', 'yaml', 'css', 'plaintext'].map(l => <option key={l}>{l}</option>)}
        </select></label>}
      </div>
      <div className="editor">
        <div className="editor-toolbar"><div className="segmented" role="group" aria-label="Visualização do texto"><button type="button" aria-pressed={tab === 'write'} onClick={() => setTab('write')}>Escrever</button><button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Prévia</button></div><span className="text-xs text-quaternary">{text.length.toLocaleString('pt-BR')} caracteres</span></div>
        {tab === 'write' ? <textarea ref={textarea} aria-label="Conteúdo para compartilhar" value={text} disabled={sending} onChange={e => setText(e.target.value)} onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void sendText() }
          if (mode !== 'markdown' && e.key === 'Tab') {
            e.preventDefault(); const a = e.currentTarget.selectionStart, b = e.currentTarget.selectionEnd
            setText(text.slice(0, a) + '  ' + text.slice(b)); requestAnimationFrame(() => textarea.current?.setSelectionRange(a + 2, a + 2))
          }
        }} placeholder={mode === 'markdown' ? '# Seu texto aqui\n\nUse **negrito**, listas, links e blocos de código.' : mode === 'command' ? 'Cole seu comando aqui…' : 'Cole seu código aqui…'} rows={7} className={mode !== 'markdown' ? 'font-mono' : ''} /> : <div className="editor-preview">{text.trim() ? <Markdown text={formatted()} /> : <p className="text-sm text-tertiary">A prévia do conteúdo aparece aqui.</p>}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-tertiary">{mode === 'markdown' ? 'Markdown com listas, tabelas e código.' : 'O conteúdo será compartilhado em um bloco de código.'} <span className="hidden sm:inline">Ctrl/⌘ + Enter para enviar.</span></p><Button size="md" iconLeading={Send01} onClick={sendText} isLoading={sending} isDisabled={!text.trim()}>Enviar texto</Button></div>
    </section>
    {erro && <p role="alert" className="text-sm text-error-primary">{erro}</p>}
    <section aria-labelledby="shared-title" className="space-y-3"><div className="flex items-center justify-between"><h2 id="shared-title" className="text-md font-semibold text-primary">Nesta sala</h2><span className="text-xs text-tertiary">{room.items.length} {room.items.length === 1 ? 'item' : 'itens'}</span></div>
      <ul className="space-y-3">{room.items.map(it => <li key={it.id} className="panel shared-item">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-primary">{it.kind === 'file' ? it.name : 'Texto compartilhado'}</p><p className="text-xs text-tertiary">{it.kind === 'file' ? fmtSize(it.size) + ' · ' : ''}{fmtTime(it.at)}</p></div>
          <div className="flex shrink-0 gap-1">{it.kind === 'file' ? <Button size="sm" color="secondary" iconLeading={Download01} href={`/api/${code}/file/${it.id}`} aria-label={`Baixar ${it.name}`} /> : <Button size="sm" color="secondary" iconLeading={copied === it.id ? Check : Copy01} onClick={() => flash(it.id, it.text || '')} aria-label="Copiar texto original" />}
            <Button size="sm" color="tertiary" iconLeading={Trash01} isLoading={removing === it.id} onClick={() => remove(it.id)} aria-label={`Apagar ${it.kind === 'file' ? it.name : 'texto'}`} /></div>
        </div>
        {it.kind === 'text' ? <Markdown text={it.text || ''} /> : /\.(png|jpe?g|webp|gif)$/i.test(it.name || '') && (it.size || 0) <= 12 * 1048576 ? <ImagePreview item={it} /> : null}
      </li>)}{!room.items.length && <li className="empty-state"><UploadCloud01 className="mx-auto mb-3 size-6 text-fg-quaternary" /><p className="text-sm font-medium text-primary">Sua sala está pronta</p><p className="mt-1 text-sm text-tertiary">Envie um arquivo ou texto. Ele aparece nos dois aparelhos.</p></li>}</ul>
    </section>
    <p className="text-center text-xs text-quaternary">A sala expira após {room.ttlHours} h sem atividade. Compartilhe o link apenas com quem deve acessá-la.</p>
  </Shell>
}
export default function App() { return code ? <RoomView /> : <Home /> }
