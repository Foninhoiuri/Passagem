// Passagem: sala privada do proprietário + salas compartilhadas por links secretos.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit, body, error, guard, json, login, logout, requireOwner, securityError, session } from './security.js'
import { addText, alive, cancelUpload, cleanup, cleanupRoom, closeRoom, createRoom, finishUpload, items, limits, rooms, sendFile, startUpload, touch, ttlMs, uploadState, validRoom, writeChunk } from './storage.js'
import {thumbnail} from './thumbnails.js'
import {documentPreview} from './previews.js'
const PORT=Number(process.env.PORT||3000)
const WEB=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../web/dist')
const VERSION=process.env.APP_VERSION||'development'
async function api(req,res,url){
 const parts=url.pathname.split('/').filter(Boolean).slice(1)
 if(parts.length===1&&parts[0]==='session'&&req.method==='GET'){const s=session(req);return json(res,200,{isAdmin:!!s,...(s?{csrfToken:s.csrf}:{})})}
 if(parts.length===1&&parts[0]==='login'&&req.method==='POST')return login(req,res)
 if(parts.length===1&&parts[0]==='logout'&&req.method==='POST')return logout(req,res)
 if(parts.length===1&&parts[0]==='rooms'&&req.method==='POST'){requireOwner(req);const c=createRoom();audit(req,'room-create',c);return json(res,201,{code:c})}
 if(parts.length===2&&parts[0]==='rooms'&&req.method==='DELETE'){requireOwner(req);if(!validRoom(parts[1]))throw error(404,'Sala não encontrada.');closeRoom(parts[1]);audit(req,'room-close',parts[1]);return json(res,200,{ok:true})}
 const [c,kind,id,operation]=parts
 if(!validRoom(c))throw error(404,'Sala não encontrada.')
 if(c==='1')requireOwner(req)
 cleanupRoom(c)
 if(!alive(c))throw error(404,'Sala não encontrada ou expirada.')
 if(parts.length===1&&req.method==='GET')return json(res,200,{items:items(c),ttlHours:c==='1'?null:ttlMs/3600e3,itemTtlHours:ttlMs/3600e3,...limits,isPrivate:c==='1',isAdmin:!!session(req),...(c==='1'?{sharedRooms:rooms()}:{})})
 if(parts.length===2&&kind==='text'&&req.method==='POST'){const {text}=await body(req,1024*1024,['text']);const item=addText(c,text);audit(req,'text-create',c);return json(res,201,item)}
 if(parts.length===2&&kind==='uploads'&&req.method==='POST'){const data=await body(req,2048,['name','size','type']);const upload=startUpload(c,data);audit(req,'upload-start',c);return json(res,201,upload)}
 if(parts.length===3&&kind==='uploads'){
  if(req.method==='GET')return json(res,200,uploadState(c,id))
  if(req.method==='PATCH'){const state=await writeChunk(c,id,req);audit(req,'upload-chunk',c);return json(res,200,state)}
  if(req.method==='DELETE'){cancelUpload(c,id);audit(req,'upload-cancel',c);return json(res,200,{ok:true})}
 }
 if(parts.length===4&&kind==='uploads'&&operation==='complete'&&req.method==='POST'){const item=finishUpload(c,id);audit(req,'file-create',c);return json(res,201,item)}
 if(parts.length===3&&kind==='preview'&&req.method==='GET'){const preview=await documentPreview(c,id);audit(req,'document-preview',c);return json(res,200,preview)}
 if(parts.length===5&&kind==='preview'&&operation==='page'&&req.method==='GET'){if(!/^[1-9][0-9]{0,3}$/.test(parts[4]))throw error(400,'Página inválida.');const result=await thumbnail(c,id,Number(parts[4]));const image=Buffer.isBuffer(result)?result:fs.readFileSync(result);audit(req,'pdf-page-read',c);res.writeHead(200,{'Content-Type':'image/webp','Content-Length':image.length});return res.end(image)}
 if(parts.length===3&&kind==='thumbnail'&&req.method==='GET'){const file=await thumbnail(c,id);audit(req,'thumbnail-read',c);res.writeHead(200,{'Content-Type':'image/webp','Content-Length':fs.statSync(file).size});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res)}
 if(parts.length===3&&kind==='file'&&['GET','HEAD'].includes(req.method)){audit(req,'file-download',c);return sendFile(req,res,c,id)}
 if(parts.length===3&&kind==='item'&&req.method==='DELETE'){remove(req,res,c,id);return}
 throw error(404,'Não encontrado.')
}
import {removeItem} from './storage.js'
function remove(req,res,c,id){const roomClosed=removeItem(c,id);audit(req,'item-delete',c);json(res,200,{ok:true,roomClosed})}
function staticFile(req,res,url){
 let decoded
 try{decoded=decodeURIComponent(url.pathname)}catch{throw error(400,'Endereço inválido.')}
 if(decoded.includes('\\')||decoded.split('/').some(p=>p.startsWith('.'))||/\.(?:map|tsx?|jsx|lock|ya?ml|env)$/i.test(decoded)||/^\/(?:src|server|node_modules|docs)(?:\/|$)/i.test(decoded))throw error(404,'Não encontrado.')
 if(!['GET','HEAD'].includes(req.method))throw error(405,'Método não permitido.')
 let file=path.resolve(WEB,'.'+decoded)
 if(file!==WEB&&!file.startsWith(WEB+path.sep))throw error(404,'Não encontrado.')
 if(!fs.existsSync(file)||fs.statSync(file).isDirectory()){
  if(decoded.startsWith('/assets/')||path.extname(decoded))throw error(404,'Não encontrado.')
  file=path.join(WEB,'index.html')
 }
 if(!fs.existsSync(file))throw error(503,'Interface indisponível.')
 const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream')
 if(/^\/(?:apple-touch-icon[^/]*\.png|icons\/[^/]+\.png)$/.test(decoded))res.setHeader('Cache-Control','public, max-age=86400')
 if(decoded.startsWith('/assets/'))res.setHeader('Cache-Control','public, max-age=31536000, immutable')
 res.setHeader('Content-Length',fs.statSync(file).size)
 if(req.method==='HEAD')return res.end()
 const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res)
}
http.createServer({requestTimeout:120000,headersTimeout:15000,maxHeaderSize:16384},(req,res)=>{
 (async()=>{
  const url=new URL(req.url,'http://local')
  if(!guard(req,res,url))return
  if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true})
  if(url.pathname==='/version'&&req.method==='GET')return json(res,200,{version:VERSION})
  if(url.pathname.startsWith('/api/'))return api(req,res,url)
  return staticFile(req,res,url)
 })().catch(e=>securityError(req,res,e))
}).listen(PORT,()=>console.log(`Passagem em :${PORT}`))
setInterval(()=>{try{cleanup()}catch(e){console.error(JSON.stringify({event:'cleanup-failed',code:e.code||'internal'}))}},60000).unref()
