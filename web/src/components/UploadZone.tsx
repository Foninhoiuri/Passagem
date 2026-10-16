import { useEffect, useRef, useState } from 'react'
import { DropZone, FileTrigger, Button as AriaButton } from 'react-aria-components'
import { Check, UploadCloud01, Trash01 } from '@untitledui/icons'

type Upload = { id: string; file: File; preview?: string; progress: number; status: 'queued' | 'uploading' | 'complete' | 'failed'; error?: string }
const size = (n: number) => n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`

export function UploadZone({ code, maxFileMb, onComplete }: { code: string; maxFileMb: number; onComplete: () => void }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const requests = useRef(new Map<string, XMLHttpRequest>())
  const urls = useRef(new Set<string>())
  const sending = uploads.some(u => u.status === 'uploading' || u.status === 'queued')
  const update = (id: string, patch: Partial<Upload>) => setUploads(old => old.map(u => u.id === id ? { ...u, ...patch } : u))

  useEffect(() => () => { requests.current.forEach(x => x.abort()); urls.current.forEach(url => URL.revokeObjectURL(url)) }, [])

  function upload(item: Upload) {
    update(item.id, { status: 'uploading', progress: 0, error: undefined })
    const x = new XMLHttpRequest()
    requests.current.set(item.id, x)
    x.open('PUT', `/api/${code}/file?name=${encodeURIComponent(item.file.name)}`)
    x.timeout = 10 * 60 * 1000
    x.upload.onprogress = e => update(item.id, { progress: e.lengthComputable ? Math.round(e.loaded * 100 / e.total) : 0 })
    x.onload = () => {
      requests.current.delete(item.id)
      if (x.status >= 200 && x.status < 300) {
        update(item.id, { status: 'complete', progress: 100 }); onComplete()
      } else {
        let message = x.status === 413 ? 'Arquivo acima do limite aceito pelo servidor.' : 'Não foi possível enviar. Tente novamente.'
        try { message = JSON.parse(x.responseText).erro || message } catch { /* Proxy may return HTML. */ }
        update(item.id, { status: 'failed', error: message })
      }
    }
    const failed = () => { requests.current.delete(item.id); update(item.id, { status: 'failed', error: 'Conexão interrompida. Tente novamente.' }) }
    x.onerror = failed; x.ontimeout = failed
    x.send(item.file)
  }

  function select(files: File[]) {
    setError('')
    const items = files.map(file => {
      // Only raster images get local previews: never execute HTML or SVG uploads.
      const preview = /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name) ? URL.createObjectURL(file) : undefined
      if (preview) urls.current.add(preview)
      return { id: crypto.randomUUID(), file, preview, progress: 0, status: 'queued' as const }
    })
    setUploads(old => [...old.filter(u => u.status !== 'complete'), ...items])
    for (const item of items) {
      if (item.file.size > maxFileMb * 1048576) update(item.id, { status: 'failed', error: `O limite é ${maxFileMb} MB por arquivo.` })
      else upload(item)
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

  function remove(item: Upload) {
    requests.current.get(item.id)?.abort(); requests.current.delete(item.id)
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
      <p className="text-sm text-tertiary">Fotos, documentos e outros arquivos, até {maxFileMb} MB cada.</p>
      <FileTrigger allowsMultiple onSelect={files => { if (files) select(Array.from(files)) }}><AriaButton className="drop-zone__trigger">Selecionar arquivos</AriaButton></FileTrigger>
      <p className="text-xs text-quaternary">Ou cole uma imagem com Ctrl+V / ⌘V</p>
    </DropZone>
    {reading && <p role="status" className="text-sm text-tertiary">Lendo arquivos…</p>}
    {error && <p role="alert" className="text-sm text-error-primary">{error}</p>}
    <ul className="space-y-2" aria-label="Progresso dos envios" aria-live="polite">
      {uploads.map(item => <li className="upload-item" key={item.id} data-status={item.status}>
        {item.preview ? <img src={item.preview} alt={`Prévia de ${item.file.name}`} className="upload-thumbnail" /> : <span className="file-format">{item.file.name.split('.').pop()?.slice(0, 5).toUpperCase() || 'ARQ'}</span>}
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary" title={item.file.name}>{item.file.name}</p>
          <p className="text-xs text-tertiary">{size(item.file.size)} · {item.status === 'complete' ? 'Enviado' : item.status === 'failed' ? 'Falha no envio' : `${item.progress}%`}</p>
          {item.status === 'uploading' && <progress className="upload-progress" value={item.progress} max={100} aria-label={`Enviando ${item.file.name}`} />}
          {item.error && <p role="alert" className="mt-1 text-xs text-error-primary">{item.error}</p>}
          {item.status === 'failed' && item.file.size <= maxFileMb * 1048576 && <button type="button" className="mt-1 text-sm font-semibold text-brand-secondary" onClick={() => upload(item)}>Tentar novamente</button>}
        </div>
        {item.status === 'complete' && <Check className="size-5 shrink-0 text-brand-secondary" aria-label="Enviado" />}
        <button type="button" className="icon-button" aria-label={`${item.status === 'uploading' ? 'Cancelar envio de' : 'Remover da lista'} ${item.file.name}`} onClick={() => remove(item)}><Trash01 className="size-4" /></button>
      </li>)}
    </ul>
    {sending && <p className="text-xs text-tertiary" role="status">Enviando… mantenha esta página aberta até concluir.</p>}
  </section>
}
