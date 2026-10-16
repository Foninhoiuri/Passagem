import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy01, Download01, Link01, Plus, Send01, Trash01, UploadCloud01 } from '@untitledui/icons'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'

type Item = { id: string; kind: 'text' | 'file'; name?: string; size?: number; text?: string; at: number }
type Room = { items: Item[]; ttlHours: number; maxFileMb: number }

const code = location.pathname.slice(1).split('/')[0]

const fmtSize = (n = 0) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const fmtTime = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // ponytail: fallback para http sem clipboard API; o Funnel já é https
    const t = document.createElement('textarea')
    t.value = text
    document.body.append(t)
    t.select()
    document.execCommand('copy')
    t.remove()
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:py-14">
      <header className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-brand-solid text-white">
          <UploadCloud01 className="size-5" />
        </div>
        <h1 className="text-xl font-semibold text-primary">Passagem</h1>
      </header>
      {children}
    </main>
  )
}

function Home() {
  const [pin, setPin] = useState(() => localStorage.getItem('pin') ?? '')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    setErro('')
    const r = await fetch('/api/rooms', { method: 'POST', headers: { 'x-pin': pin } })
    const j = await r.json()
    setBusy(false)
    if (!r.ok) return setErro(j.erro)
    localStorage.setItem('pin', pin)
    location.href = '/' + j.code
  }

  return (
    <Shell>
      <section className="flex flex-col gap-4 rounded-xl bg-primary p-5 shadow-xs ring-1 ring-secondary ring-inset">
        <p className="text-md text-tertiary">Crie uma sala, abra o link em qualquer computador e troque textos, arquivos e fotos.</p>
        <Input label="PIN" type="password" value={pin} onChange={setPin} isInvalid={!!erro} hint={erro} />
        <Button size="lg" iconLeading={Plus} isLoading={busy} isDisabled={!pin} onClick={create}>
          Nova sala
        </Button>
      </section>
    </Shell>
  )
}

function RoomView() {
  const [room, setRoom] = useState<Room | null>(null)
  const [erro, setErro] = useState('')
  const [text, setText] = useState('')
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [over, setOver] = useState(false)
  const [copied, setCopied] = useState('')
  const pick = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/${code}`)
    if (!r.ok) return setErro((await r.json()).erro)
    setRoom(await r.json())
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  const upload = (file: File) =>
    new Promise<void>((resolve) => {
      const key = file.name + file.size + Math.random()
      const x = new XMLHttpRequest()
      x.open('PUT', `/api/${code}/file?name=${encodeURIComponent(file.name || 'colado.png')}`)
      x.upload.onprogress = (e) => setProgress((p) => ({ ...p, [key]: e.loaded / (e.total || file.size) }))
      x.onloadend = () => {
        setProgress(({ [key]: _, ...p }) => p)
        if (x.status >= 400) setErro(JSON.parse(x.responseText || '{}').erro ?? 'Falha no envio.')
        load()
        resolve()
      }
      x.send(file)
    })

  const sendFiles = (files: FileList | File[]) => {
    setErro('')
    Array.from(files).forEach(upload)
  }

  const sendText = async () => {
    if (!text.trim()) return
    await fetch(`/api/${code}/text`, { method: 'POST', body: JSON.stringify({ text }) })
    setText('')
    load()
  }

  // Ctrl+V na página: imagem/arquivo vira upload; texto cai no campo
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) {
        e.preventDefault()
        sendFiles(e.clipboardData.files)
      }
    }
    addEventListener('paste', onPaste)
    return () => removeEventListener('paste', onPaste)
  })

  const remove = async (id: string) => {
    await fetch(`/api/${code}/item/${id}`, { method: 'DELETE' })
    load()
  }

  const flash = async (id: string, value: string) => {
    await copy(value)
    setCopied(id)
    setTimeout(() => setCopied(''), 1500)
  }

  if (erro && !room)
    return (
      <Shell>
        <p className="text-md text-error-primary">{erro}</p>
        <Button color="secondary" href="/">Criar outra sala</Button>
      </Shell>
    )

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary p-3">
        <span className="min-w-0 truncate text-sm text-tertiary">{location.host}/<b className="text-primary">{code}</b></span>
        <Button size="sm" color="secondary" iconLeading={copied === 'link' ? Check : Link01} onClick={() => flash('link', location.href)}>
          Copiar link
        </Button>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); sendFiles(e.dataTransfer.files) }}
        onClick={() => pick.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${over ? 'border-brand bg-brand-primary' : 'border-secondary bg-primary'}`}
      >
        <UploadCloud01 className="size-8 text-fg-quaternary" />
        <p className="text-md font-semibold text-primary">Toque para enviar ou arraste arquivos</p>
        <p className="text-sm text-tertiary">Também vale colar (Ctrl+V). Até {room?.maxFileMb ?? '…'} MB por arquivo.</p>
        <input ref={pick} type="file" multiple hidden onChange={(e) => { if (e.target.files) sendFiles(e.target.files); e.target.value = '' }} />
      </div>

      {Object.entries(progress).map(([k, v]) => (
        <div key={k} className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-brand-solid transition-all" style={{ width: `${v * 100}%` }} />
        </div>
      ))}
      {erro && <p className="text-sm text-error-primary">{erro}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva ou cole um texto…"
          rows={3}
          className="w-full flex-1 resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset focus:ring-2 focus:ring-brand"
        />
        <Button size="lg" iconLeading={Send01} onClick={sendText} isDisabled={!text.trim()}>Enviar</Button>
      </div>

      <ul className="flex flex-col gap-2">
        {room?.items.map((it) => (
          <li key={it.id} className="flex items-start gap-3 rounded-xl bg-primary p-3 shadow-xs ring-1 ring-secondary ring-inset">
            <div className="min-w-0 flex-1">
              {it.kind === 'file' ? (
                <>
                  <p className="truncate text-sm font-medium text-primary">{it.name}</p>
                  <p className="text-xs text-tertiary">{fmtSize(it.size)} · {fmtTime(it.at)}</p>
                </>
              ) : (
                <>
                  <p className="line-clamp-6 text-sm whitespace-pre-wrap break-words text-primary">{it.text}</p>
                  <p className="text-xs text-tertiary">{fmtTime(it.at)}</p>
                </>
              )}
            </div>
            {it.kind === 'file' ? (
              <Button size="sm" color="secondary" iconLeading={Download01} href={`/api/${code}/file/${it.id}`} aria-label="Baixar" />
            ) : (
              <Button size="sm" color="secondary" iconLeading={copied === it.id ? Check : Copy01} onClick={() => flash(it.id, it.text!)} aria-label="Copiar" />
            )}
            <Button size="sm" color="tertiary" iconLeading={Trash01} onClick={() => remove(it.id)} aria-label="Apagar" />
          </li>
        ))}
        {room && !room.items.length && <li className="py-6 text-center text-sm text-tertiary">Nada por aqui ainda.</li>}
      </ul>

      <p className="text-center text-xs text-quaternary">A sala some após {room?.ttlHours ?? 24} h sem uso.</p>
    </Shell>
  )
}

export default function App() {
  return code ? <RoomView /> : <Home />
}
