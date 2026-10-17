import { useEffect, useRef, useState } from 'react'
import { DropZone, FileTrigger, Button as AriaButton } from 'react-aria-components'
import { Check, UploadCloud01, Trash01 } from '@untitledui/icons'
import { api, requestHeaders } from '@/utils/api'

type Upload = { id: string; file: File; preview?: string; thumbnail?: string; progress: number; status: 'queued' | 'uploading' | 'complete' | 'failed' | 'paused'; error?: string }
const size = (n: number) => n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`

export function UploadZone({ code, maxFileMb, onComplete }: { code: string; maxFileMb: number; onComplete: () => void }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const requests = useRef(new Map<string, XMLHttpRequest>())
  const transfers = useRef(new Map<string, { controller: AbortController; uploadId?: string; key?: string }>())
  const mounted = useRef(true)
  const urls = useRef(new Set<string>())
  const savedTransfers = useRef(new Map<string, {uploadId: string; key: string}>())
  const sending = uploads.some(u => u.status === 'uploading' || u.status === 'queued')
  const update = (id: string, patch: Partial<Upload>) => setUploads(old => old.map(u => u.id === id ? { ...u, ...patch } : u))

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; transfers.current.forEach(t => t.controller.abort()); requests.current.forEach(x => x.abort()); urls.current.forEach(url => URL.revokeObjectURL(url)) } }, [])

  const remember = (key: string, id?: string) => { try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key) } catch { /* Resume in this page still works if storage is unavailable. */ } }
  async function upload(item: Upload) {
    if (transfers.current.has(item.id)) return
    const transfer = { controller: new AbortController(), uploadId: undefined as string | undefined, key: undefined as string | undefined }
    transfers.current.set(item.id, transfer)
    update(item.id, { status: 'uploading', error: undefined })
    const signal = transfer.controller.signal
    try {
      const sample = await new Blob([item.file.slice(0, 65536), item.file.slice(Math.max(0, item.file.size - 65536)), String(item.file.size), item.file.name, String(item.file.lastModified)]).arrayBuffer()
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sample)), b => b.toString(16).padStart(2, '0')).join('')
      const key = `passagem-resume:${code}:${digest}`
      transfer.key = key
      let saved: string | null = null
      try { saved = sessionStorage.getItem(key) } catch { /* Optional persistence. */ }
      let state
      if (saved) {
        try { state = await api(`/api/${code}/uploads/${saved}`, { signal }) }
        catch (e) { if ((e as {status?: number}).status !== 404) throw e; remember(key) }
      }
      if (!state) state = await api(`/api/${code}/uploads`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: item.file.name || 'colado.png', size: item.file.size, type: item.file.type || 'application/octet-stream' }) })
      if (state.complete) { remember(key); update(item.id, { status: 'complete', progress: 100, thumbnail: /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?)$/i.test(item.file.name) ? `/api/${code}/thumbnail/${state.item.id}` : undefined }); onComplete(); return }
      const uploadId = String(state.id), chunkSize = Math.min(Number(state.chunkSize), 16 * 1048576)
      if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('Tamanho de parte inválido. Atualize a página.')
      transfer.uploadId = uploadId; savedTransfers.current.set(item.id, {uploadId,key}); remember(key, uploadId)
      let offset = Number(state.offset)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > item.file.size) throw new Error('Posição de envio inválida.')
      update(item.id, { progress: item.file.size ? Math.floor(offset * 100 / item.file.size) : 0 })
      while (offset < item.file.size) {
        if (signal.aborted) throw new DOMException('Pausado', 'AbortError')
        const from = offset, chunk = item.file.slice(from, Math.min(from + chunkSize, item.file.size))
        const result = await new Promise<{ offset: number }>((resolve, reject) => {
          const x = new XMLHttpRequest(); requests.current.set(item.id, x)
          x.open('PATCH', `/api/${code}/uploads/${uploadId}`); x.timeout = 120000
          for (const [k,v] of Object.entries(requestHeaders({ 'Upload-Offset': String(from), 'Content-Type': 'application/octet-stream' }))) x.setRequestHeader(k,v)
          x.upload.onprogress = e => update(item.id, { progress: Math.min(99, Math.floor((from + e.loaded) * 100 / item.file.size)) })
          const abort = () => { x.abort(); reject(new DOMException('Pausado', 'AbortError')) }
          signal.addEventListener('abort', abort, { once: true })
          x.onloadend = () => { signal.removeEventListener('abort', abort); requests.current.delete(item.id) }
          x.onload = () => {
            let data: { erro?: string; offset?: number } = {}
            try { data = JSON.parse(x.responseText) } catch { /* Cloudflare may return HTML. */ }
            if (x.status >= 200 && x.status < 300 && Number.isSafeInteger(data.offset) && data.offset! > from) resolve({ offset: data.offset! })
            else reject(new Error(data.erro || 'Envio interrompido. Use Retomar para continuar de onde parou.'))
          }
          x.onerror = x.ontimeout = () => reject(new Error('Conexão interrompida. Use Retomar para continuar de onde parou.'))
          x.onabort = () => reject(new DOMException('Pausado', 'AbortError'))
          x.send(chunk)
        })
        offset = result.offset
      }
      const completed = await api(`/api/${code}/uploads/${uploadId}/complete`, { method: 'POST', signal })
      remember(key); update(item.id, { status: 'complete', progress: 100, thumbnail: /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?)$/i.test(item.file.name) ? `/api/${code}/thumbnail/${completed.id}` : undefined }); onComplete()
    } catch (e) {
      if (!mounted.current) return
      update(item.id, { status: signal.aborted ? 'paused' : 'failed', error: signal.aborted ? undefined : e instanceof Error ? e.message : 'Não foi possível enviar. Tente retomar.' })
    } finally { transfers.current.delete(item.id); requests.current.delete(item.id) }
  }

  function select(files: File[]) {
    setError('')
    const items = files.map(file => {
      // Only raster images get local previews: never execute HTML or SVG uploads.
      const preview = /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name) && file.size <= 20 * 1048576 ? URL.createObjectURL(file) : undefined
      if (preview) urls.current.add(preview)
      return { id: crypto.randomUUID(), file, preview, progress: 0, status: 'queued' as const }
    })
    for (const done of uploads.filter(u => u.status === 'complete' && u.preview)) { URL.revokeObjectURL(done.preview!); urls.current.delete(done.preview!) }
    setUploads(old => [...old.filter(u => u.status !== 'complete'), ...items])
    for (const item of items) {
      if (item.file.size > maxFileMb * 1048576) update(item.id, { status: 'failed', error: `O limite é ${maxFileMb} MB por arquivo.` })
      else void upload(item)
    }
  }

  // Keep pasted images and files consistent with picker and drag-and-drop uploads.
  const selectRef = useRef(select)
  selectRef.current = select
  useEffect(() => {
    function paste(e: ClipboardEvent) {
      if (e.clipboardData?.files.length) { e.preventDefault(); selectRef.current(Array.from(e.clipboardData.files)) }
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])

  async function remove(item: Upload) {
    const transfer = transfers.current.get(item.id)
    const saved = savedTransfers.current.get(item.id)
    transfer?.controller.abort(); requests.current.get(item.id)?.abort()
    if (transfer?.uploadId || saved?.uploadId) {
      try {
        for (let n=0;n<4;n++) {
          try { await api(`/api/${code}/uploads/${transfer?.uploadId || saved?.uploadId}`, { method: 'DELETE' }); break }
          catch (e) { if ((e as {status?:number}).status !== 409 || n===3) throw e; await new Promise(resolve => setTimeout(resolve,200)) }
        }
      } catch { /* Interrupted parts expire if the network is unavailable. */ }
    }
    if (transfer?.key || saved?.key) remember(transfer?.key || saved!.key)
    savedTransfers.current.delete(item.id)
    if (item.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview) }
    setUploads(old => old.filter(u => u.id !== item.id))
  }

  return <section aria-labelledby="upload-title" className="space-y-4">
    <div><h2 id="upload-title" className="text-md font-semibold text-primary">Arquivos e fotos</h2><p className="text-sm text-tertiary">Do celular para o computador. Ou ao contrário.</p></div>
    <DropZone className="drop-zone__area" aria-label="Área para enviar arquivos" getDropOperation={types => types.has('Files') ? 'copy' : 'cancel'}
      onDrop={async e => {
        setReading(true)
        try {
          const files = await Promise.all(e.items.filter(i => i.kind === 'file').map(i => i.kind === 'file' ? i.getFile() : Promise.reject()))
          select(files)
        } catch { setError('Não foi possível ler os arquivos. Use Selecionar arquivos.') } finally { setReading(false) }
      }}>
      <div className="drop-zone__icon"><UploadCloud01 className="size-6" /></div>
      <p className="text-md font-semibold text-primary">Arraste seus arquivos para cá</p>
      <p className="text-sm text-tertiary">Fotos, documentos e outros arquivos, até {maxFileMb >= 1024 ? `${(maxFileMb / 1024).toFixed(0)} GB` : `${maxFileMb} MB`} cada.</p>
      <FileTrigger allowsMultiple onSelect={files => { if (files) select(Array.from(files)) }}><AriaButton className="drop-zone__trigger">Selecionar arquivos</AriaButton></FileTrigger>
      <p className="text-xs text-quaternary">Ou cole uma imagem com Ctrl+V / ⌘V</p>
    </DropZone>
    {reading && <p role="status" className="text-sm text-tertiary">Lendo arquivos…</p>}
    {error && <p role="alert" className="text-sm text-error-primary">{error}</p>}
    <ul className="space-y-2" aria-label="Progresso dos envios" aria-live="polite">
      {uploads.map(item => <li className="upload-item" key={item.id} data-status={item.status}>
        {item.thumbnail || item.preview ? <img src={item.thumbnail || item.preview} alt={`Prévia de ${item.file.name}`} className="upload-thumbnail" onError={() => update(item.id, {thumbnail: undefined, preview: undefined})} /> : <span className="file-format">{item.file.name.split('.').pop()?.slice(0, 5).toUpperCase() || 'ARQ'}</span>}
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary" title={item.file.name}>{item.file.name}</p>
          <p className="text-xs text-tertiary">{size(item.file.size)} · {item.status === 'complete' ? 'Enviado' : item.status === 'failed' ? 'Envio interrompido' : item.status === 'paused' ? `Pausado em ${item.progress}%` : `${item.progress}%`}</p>
          {item.status === 'uploading' && <progress className="upload-progress" value={item.progress} max={100} aria-label={`Enviando ${item.file.name}`} />}
          {item.error && <p role="alert" className="mt-1 text-xs text-error-primary">{item.error}</p>}
          {(item.status === 'failed' || item.status === 'paused') && item.file.size <= maxFileMb * 1048576 && <button type="button" className="mt-1 text-sm font-semibold text-brand-secondary" onClick={() => upload(item)}>Retomar envio</button>}
        </div>
        {item.status === 'uploading' && <button type="button" className="text-xs font-semibold text-brand-secondary" onClick={() => transfers.current.get(item.id)?.controller.abort()} aria-label={`Pausar envio de ${item.file.name}`}>Pausar</button>}
        {item.status === 'complete' && <Check className="size-5 shrink-0 text-brand-secondary" aria-label="Enviado" />}
        <button type="button" className="icon-button" aria-label={`${item.status === 'uploading' ? 'Cancelar envio de' : 'Remover da lista'} ${item.file.name}`} onClick={() => remove(item)}><Trash01 className="size-4" /></button>
      </li>)}
    </ul>
    <p className="text-xs text-tertiary">Se fechar a página, selecione o mesmo arquivo para retomar nesta sessão do navegador.</p>
    {sending && <p className="text-xs text-tertiary" role="status">Envio em partes. Se a conexão cair, retome sem começar do zero.</p>}
  </section>
}
