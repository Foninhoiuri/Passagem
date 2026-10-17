import {useState} from 'react'
import {Dialog,Modal,ModalOverlay} from 'react-aria-components'
import {Button} from '@/components/base/buttons/button'
import {api} from '@/utils/api'
type Info={pages:number;maxPreviewPage:number}
export function PdfPreview({code,id,name}:{code:string;id:string;name:string}){
 const[open,setOpen]=useState(false),[info,setInfo]=useState<Info|null>(null),[page,setPage]=useState(1),[error,setError]=useState(''),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0)
 const thumbnail=`/api/${code}/thumbnail/${id}${retry?'?retry='+retry:''}`
 const show=async()=>{setOpen(true);setError('');setBusy(true);try{setInfo(await api(`/api/${code}/preview/${id}`));setPage(1)}catch(e){setError(e instanceof Error?e.message:'Não foi possível abrir o PDF.')}finally{setBusy(false)}}
 return <figure className="pdf-preview">
  {failed?<button type="button" className="text-left text-sm font-medium text-brand-secondary" onClick={()=>{setFailed(false);setRetry(n=>n+1)}}>Miniatura indisponível · tentar novamente</button>:<button type="button" className="pdf-cover" aria-label={`Abrir prévia de ${name}`} onClick={()=>void show()}><img src={thumbnail} alt={`Primeira página de ${name}`} loading="lazy" className="received-image" onError={()=>setFailed(true)}/></button>}
  <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-tertiary"><span>PDF · primeira página</span><Button size="sm" color="secondary" onClick={()=>void show()}>Pré-visualizar PDF</Button></figcaption>
  <ModalOverlay isOpen={open} onOpenChange={setOpen} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-3 backdrop-blur-sm"><Modal className="panel pdf-dialog w-full max-w-4xl"><Dialog aria-label={`Prévia de ${name}`} className="outline-none">
   <div className="mb-3 flex items-center justify-between gap-3"><h2 className="min-w-0 truncate text-md font-semibold text-primary">{name}</h2><Button size="sm" color="secondary" onClick={()=>setOpen(false)}>Fechar prévia</Button></div>
   {busy&&<p role="status">Preparando prévia…</p>}{error&&<p role="alert" className="text-sm text-error-primary">{error}</p>}
   {info&&!busy&&!error&&<><div className="pdf-page"><img key={`${page}:${retry}`} src={page===1?thumbnail:`/api/${code}/preview/${id}/page/${page}?retry=${retry}`} alt={`Página ${page} de ${name}`} onLoad={()=>setFailed(false)} onError={()=>setError('Não foi possível carregar esta página. Feche e tente novamente.')}/></div><div className="mt-3 flex items-center justify-between gap-2"><Button size="sm" color="secondary" isDisabled={page===1} onClick={()=>setPage(n=>n-1)}>Anterior</Button><span aria-live="polite" className="text-xs text-tertiary">Página {page} de {info.pages}</span><Button size="sm" color="secondary" isDisabled={page>=info.maxPreviewPage} onClick={()=>setPage(n=>n+1)}>Próxima</Button></div>{info.pages>info.maxPreviewPage&&<p className="mt-2 text-xs text-tertiary">Prévia das primeiras {info.maxPreviewPage} páginas. Baixe o original para consultar o documento completo.</p>}</>}
   <p className="mt-3 text-xs text-tertiary">Prévia para leitura. O arquivo original está disponível no botão de download.</p>
  </Dialog></Modal></ModalOverlay>
 </figure>
}
