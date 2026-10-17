import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {getFile} from './storage.js'
import {error} from './security.js'
import {withPreviewSlot} from './thumbnails.js'
const execute=promisify(execFile)
export async function documentPreview(c,id){
 const{item,file}=getFile(c,id)
 if(path.extname(item.name||'').toLowerCase()!=='.pdf')throw error(415,'Este visualizador aceita documentos PDF.')
 if(item.size>50*1048576)throw error(413,'A prévia de PDF está limitada a 50 MB. Baixe o original para abrir.')
 try{
  const args=[file],linux=process.platform==='linux'
  const{stdout}=await withPreviewSlot(()=>execute(linux?'prlimit':'pdfinfo',linux?['--as=268435456','--cpu=5','--nofile=64','--','pdfinfo',...args]:args,{timeout:8000,killSignal:'SIGKILL',maxBuffer:65536}))
  const matches=[...stdout.matchAll(/^Pages:\s+(\d+)\s*$/gm)],pages=Number(matches.at(-1)?.[1])
  if(!Number.isSafeInteger(pages)||pages<1)throw new Error('Invalid pages')
  return{kind:'pdf',pages,maxPreviewPage:Math.min(pages,1000)}
 }catch(e){if(e.status)throw e;throw error(422,'Não foi possível abrir a prévia. O PDF pode estar protegido ou danificado.')}
}
