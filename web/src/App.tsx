import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy01, Download01, Link01, Plus, Send01, Trash01, UploadCloud01 } from '@untitledui/icons'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { UploadZone } from '@/components/UploadZone'
import { Markdown } from '@/components/Markdown'
import { copy } from '@/utils/clipboard'
import { PwaInstall } from '@/components/PwaInstall'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { api, ApiError, setCsrf } from '@/utils/api'
import './App.css'

type Item = { id: string; kind: 'text' | 'file'; name?: string; size?: number; text?: string; at: number; expiresAt?: number }
type Room = { items: Item[]; ttlHours: number | null; maxFileMb: number; maxRoomMb: number; itemTtlHours: number; isPrivate: boolean; isAdmin: boolean; sharedRooms?: {code: string; expiresAt: number}[] }
const code = location.pathname.slice(1).split('/')[0] || '1'
const fmtSize = (n = 0) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
const fmtTime = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const message = (e: unknown) => e instanceof Error ? e.message : 'Sem conexão. Tente novamente.'

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <header className="flex items-center gap-3"><a href="/" aria-label="Passagem, início" className="flex size-11 items-center justify-center rounded-xl bg-brand-solid text-white"><svg className="size-7" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M48 48H136V16L200 80L136 144V112H88V152H48Z M208 208H120V240L56 176L120 112V144H168V104H208Z" /></svg></a>
      <div><h1 className="text-xl font-semibold text-primary">Passagem</h1><p className="text-sm text-tertiary">Uma ponte entre suas telas.</p></div></header>
    {children}
    <PwaInstall />
  </main>
}
function Home({ onLogin }: { onLogin: () => void }) {
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { try { localStorage.removeItem('pin') } catch { /* Browser storage may be disabled. */ } const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000))
  const enter = async () => {
    if (busy || !pin || remaining) return
    setBusy(true); setErro('')
    try {
      const j = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
      setCsrf(j.csrfToken); setPin(''); onLogin()
    } catch (e) { setErro(message(e)); if (e instanceof ApiError && e.retryAfter) setRetryAt(Date.now() + e.retryAfter * 1000) } finally { setBusy(false) }
  }
  return <Shell><form onSubmit={e => { e.preventDefault(); void enter() }} className="panel space-y-5">
    <div><p className="mb-2 text-xs font-semibold text-brand-secondary">SALA 1 · PRIVADA</p><h2 className="text-lg font-semibold text-primary">Sua sala, sempre no mesmo lugar.</h2><p className="mt-2 text-md text-tertiary">Entre com sua senha para acessar seus arquivos e criar salas para compartilhar com outras pessoas.</p></div>
    <Input label="Senha" type="password" autoComplete="current-password" value={pin} onChange={setPin} isInvalid={!!erro} hint={erro} />
    {remaining > 0 && <p role="status" className="text-sm text-tertiary">Tente novamente em {Math.ceil(remaining / 60)} min.</p>}
    <Button type="submit" size="lg" isLoading={busy} isDisabled={!pin || remaining > 0}>Entrar na minha sala</Button>
    <p className="text-xs text-tertiary">A senha não fica salva no navegador. Tentativas incorretas têm limite.</p>
  </form></Shell>
}
function ImagePreview({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  return failed ? <button type="button" className="text-left text-xs font-medium text-brand-secondary" onClick={() => { setFailed(false); setRetry(n => n + 1) }}>Prévia indisponível · tentar novamente</button> : <img src={`/api/${code}/thumbnail/${item.id}${retry ? '?retry=' + retry : ''}`} alt={`Prévia de ${item.name}`} loading="lazy" className="received-image" onError={() => setFailed(true)} />
}
function RoomView({ onLogout }: { onLogout: () => void }) {
  const [room, setRoom] = useState<Room | null>(null)
  const [erro, setErro] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'markdown' | 'code' | 'command'>('markdown')
  const [language, setLanguage] = useState('bash')
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState('')
  const [removing, setRemoving] = useState('')
  const [creating, setCreating] = useState(false)
  const [closeCode, setCloseCode] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    try { setRoom(await api(`/api/${code}`)); setErro('') } catch (e) { setErro(message(e)); if (e instanceof ApiError && e.status === 404) setRoom(null); if (e instanceof ApiError && e.status === 401 && code === '1') { setCsrf(); onLogout() } } finally { setLoaded(true) }
  }, [onLogout])
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load() }, 4000); return () => clearInterval(t) }, [load])
  const createShared = async () => {
    if (creating) return
    setCreating(true)
    try { const j = await api('/api/rooms', { method: 'POST' }); location.href = '/' + j.code } catch (e) { setErro(message(e)) } finally { setCreating(false) }
  }
  const logout = async () => {
    try { await api('/api/logout', { method: 'POST' }); setCsrf(); onLogout() } catch (e) { setErro(message(e)) }
  }
  const closeShared = async () => {
    if (!closeCode) return
    try { await api('/api/rooms/' + closeCode, { method: 'DELETE' }); setCloseCode(''); await load() } catch (e) { setErro(message(e)) }
  }
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
    try { const result = await api(`/api/${code}/item/${id}`, { method: 'DELETE' }); setConfirmDelete(null); if (result.roomClosed) { setRoom(null); setLoaded(true); setErro('Todos os itens foram apagados. Esta sala compartilhada foi encerrada.') } else await load() } catch (e) { setErro(message(e)) } finally { setRemoving('') }
  }
  const flash = async (id: string, value: string) => {
    try { await copy(value); setCopied(id); setTimeout(() => setCopied(''), 1500) } catch (e) { setErro(message(e)) }
  }
  if (!room) return <Shell>{!loaded ? <p role="status" className="text-tertiary">Abrindo sala…</p> : <><p role="alert" className="text-error-primary">{erro}</p><Button color="secondary" href="/">Voltar à sala privada</Button></>}</Shell>
  return <Shell>
    <div className="panel flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-semibold text-brand-secondary">{room.isPrivate ? 'SALA 1 · PRIVADA' : 'SALA COMPARTILHADA'}</p><p className="mt-1 text-sm text-tertiary">{room.isPrivate ? 'Seus arquivos ficam aqui. Só você cria salas para convidados.' : 'Quem tem o link pode enviar e baixar. Não precisa de senha.'}</p></div>
      <div className="flex flex-wrap gap-2">{room.isPrivate ? <><Button size="sm" iconLeading={Plus} onClick={createShared} isLoading={creating}>Criar sala compartilhada</Button><Button size="sm" color="tertiary" onClick={logout}>Sair</Button></> : <>{room.isAdmin && <Button size="sm" color="tertiary" href="/1">Minha sala</Button>}<Button size="sm" color="secondary" iconLeading={copied === 'link' ? Check : Link01} onClick={() => flash('link', location.href)}>Copiar link</Button></>}</div>
      {!room.isPrivate && <p className="w-full break-all text-xs text-quaternary">{location.host}/{code}</p>}
    </div>
    {room.isPrivate && !!room.sharedRooms?.length && <section className="panel space-y-3" aria-labelledby="shared-rooms-title"><h2 id="shared-rooms-title" className="text-sm font-semibold text-primary">Suas salas compartilhadas</h2><ul className="space-y-3">{room.sharedRooms.map((r, i) => <li key={r.code} className="flex flex-wrap items-center justify-between gap-2 border-b border-secondary pb-3 last:border-0 last:pb-0"><div><a href={'/' + r.code} className="text-sm font-medium text-brand-secondary">Sala compartilhada {i + 1}</a><p className="text-xs text-tertiary">Último item expira em {fmtTime(r.expiresAt)}.</p></div><div className="flex gap-2"><Button size="sm" color="secondary" onClick={() => flash(r.code, location.origin + '/' + r.code)}>{copied === r.code ? 'Copiado' : 'Copiar link'}</Button><Button size="sm" color="tertiary" onClick={() => setCloseCode(r.code)}>Encerrar</Button></div></li>)}</ul>
      {closeCode && <div className="rounded-lg bg-secondary p-3" role="alert"><p className="text-sm text-primary">Encerrar esta sala e apagar seus arquivos? O link deixará de funcionar.</p><div className="mt-3 flex gap-2"><Button size="sm" onClick={closeShared}>Encerrar e apagar</Button><Button size="sm" color="secondary" onClick={() => setCloseCode('')}>Cancelar</Button></div></div>}
    </section>}
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
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-primary">{it.kind === 'file' ? it.name : 'Texto compartilhado'}</p><p className="text-xs text-tertiary">{it.kind === 'file' ? fmtSize(it.size) + ' · ' : ''}{fmtTime(it.at)}{it.expiresAt && <span className="block">Expira em {fmtTime(it.expiresAt)}</span>}</p></div>
          <div className="flex shrink-0 gap-1">{it.kind === 'file' ? <Button size="sm" color="secondary" iconLeading={Download01} href={`/api/${code}/file/${it.id}`} aria-label={`Baixar ${it.name}`} /> : <Button size="sm" color="secondary" iconLeading={copied === it.id ? Check : Copy01} onClick={() => flash(it.id, it.text || '')} aria-label="Copiar texto original" />}
            <Button size="sm" color="tertiary" iconLeading={Trash01} isLoading={removing === it.id} onClick={() => setConfirmDelete(it)} aria-label={`Apagar ${it.kind === 'file' ? it.name : 'texto'}`} /></div>
        </div>
        {it.kind === 'text' ? <Markdown text={it.text || ''} /> : /\.(png|jpe?g|webp|gif|avif)$/i.test(it.name || '') && (it.size || 0) <= 50 * 1048576 ? <ImagePreview item={it} /> : null}
      </li>)}{!room.items.length && <li className="empty-state"><UploadCloud01 className="mx-auto mb-3 size-6 text-fg-quaternary" /><p className="text-sm font-medium text-primary">Sua sala está pronta</p><p className="mt-1 text-sm text-tertiary">Envie um arquivo ou texto. Ele aparece nos dois aparelhos.</p></li>}</ul>
    </section>
    <p className="text-center text-xs text-quaternary">Cada arquivo e texto expira após {room.itemTtlHours} h do envio. {room.isPrivate ? 'Sua sala privada continua disponível mesmo vazia. Saia ao usar computadores de outras pessoas.' : 'Quando não houver mais itens, esta sala será encerrada. O link dá acesso a quem o tiver.'}</p>
    <ModalOverlay isOpen={!!confirmDelete} onOpenChange={open => { if (!open && !removing) setConfirmDelete(null) }} isDismissable={!removing} className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 p-4 backdrop-blur-sm">
      <Modal className="panel w-full max-w-md"><Dialog aria-labelledby="delete-title" className="outline-none"><h2 id="delete-title" className="text-lg font-semibold text-primary">Apagar este item?</h2><p className="mt-2 break-words text-sm text-tertiary">{confirmDelete?.kind === 'file' ? confirmDelete.name : 'O texto compartilhado'} será apagado para todos nesta sala.</p>{!room.isPrivate && room.items.length === 1 && <p className="mt-2 text-sm text-tertiary">Como é o último item, a sala também será encerrada se não houver envio em andamento.</p>}<div className="mt-5 flex justify-end gap-2"><Button color="secondary" isDisabled={!!removing} onClick={() => setConfirmDelete(null)}>Cancelar</Button><Button isLoading={!!removing} onClick={() => { if (confirmDelete) void remove(confirmDelete.id) }}>Apagar para todos</Button></div></Dialog></Modal>
    </ModalOverlay>
  </Shell>
}
export default function App() {
  const [admin, setAdmin] = useState<boolean | null>(null)
  const locked = useCallback(() => setAdmin(false), [])
  useEffect(() => {
    localStorage.removeItem('pin')
    api('/api/session').then(j => { setCsrf(j.csrfToken); setAdmin(j.isAdmin) }).catch(() => setAdmin(false))
  }, [])
  if (admin === null) return <Shell><p role="status" className="text-tertiary">Abrindo Passagem…</p></Shell>
  if (code === '1' && !admin) return <Home onLogin={() => { history.replaceState(null, '', '/1'); setAdmin(true) }} />
  return <RoomView onLogout={locked} />
}
