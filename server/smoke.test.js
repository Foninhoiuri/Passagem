// Security and transfer regression tests. Only synthetic data in temporary directories.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { setTimeout as delay } from 'node:timers/promises'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'passagem-security-'))
const testPin = crypto.randomBytes(12).toString('hex')
async function start(extra = {}) {
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r))
 const env={...process.env,NODE_ENV:'test',ADMIN_PIN:testPin,PORT:String(port),PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,DATA_DIR:DATA,MAX_FILE_MB:'4',MAX_ROOM_MB:'5',MAX_TOTAL_MB:'7',MIN_FREE_MB:'0',UPLOAD_CHUNK_MB:'1',...extra}
 const server=spawn(process.execPath,['server/index.js'],{env,stdio:['ignore','pipe','pipe']})
 await Promise.race([new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',code=>reject(new Error('Servidor encerrou: '+code)))}),delay(10000,undefined,{ref:false}).then(()=>{throw new Error('Servidor não iniciou')})])
 return {server,base:`http://127.0.0.1:${port}`,stop:()=>new Promise(r=>{server.once('exit',r);server.kill()})}
}
let running=await start()
let cookie='',csrf=''
function headers(owner=false){return {'x-passagem-client':'1',...(owner?{cookie,'x-csrf-token':csrf}:{})}}
async function req(url,method='GET',data,owner=false,extra={}){return fetch(running.base+url,{method,headers:{...headers(owner),...(data&&typeof data==='object'&&!Buffer.isBuffer(data)?{'content-type':'application/json'}:{}),...extra},body:data===undefined?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data),redirect:'manual'})}
async function login(){const r=await req('/api/login','POST',{pin:testPin});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrfToken;assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/)}
async function create(){const r=await req('/api/rooms','POST',undefined,true);assert.equal(r.status,201);const c=(await r.json()).code;assert.match(c,/^[A-Za-z0-9_-]{32}$/);return c}
async function init(c,name,size,type='application/octet-stream',owner=false){return req(`/api/${c}/uploads`,'POST',{name,size,type},owner)}
try{
 assert.equal((await req('/api/1')).status,401,'private list needs login')
 assert.equal((await req('/api/1/text','POST',{text:'denied'})).status,401)
 assert.equal((await req('/api/rooms','POST',undefined,false,{'x-pin':testPin})).status,401,'raw PIN cannot create rooms')
 assert.equal((await req('/api/login','POST',{pin:'wrong'})).status,401)
 await login()
 const priv=await req('/api/1','GET',undefined,true);assert.equal(priv.status,200);assert.equal((await priv.json()).isPrivate,true)
 assert.equal((await req('/api/rooms','POST',undefined,true,{'x-csrf-token':'wrong'})).status,403,'CSRF required')
 assert.equal((await req('/api/rooms','POST',undefined,true,{origin:'https://untrusted.invalid'})).status,403,'foreign origin rejected')
 assert.equal((await req('/api/1/text','POST',{text:'secret',admin:true},true)).status,400,'unknown fields rejected')
 const privateText=await(await req('/api/1/text','POST',{text:'private-only'},true)).json()
 const c=await create(),other=await create()
 assert.equal((await req(`/api/${c}`)).status,200,'guests need no password')
 const text=await req(`/api/${c}/text`,'POST',{text:'guest message'});assert.equal(text.status,201)
 assert.equal((await req('/api/rooms','POST',undefined,false)).status,401,'guest cannot create rooms')
 assert.equal((await req(`/api/rooms/${c}`,'DELETE')).status,401,'guest cannot close rooms')
 assert.equal((await init(c,'x.svg',5,'image/svg+xml')).status,415)
 assert.equal((await init(c,'x.txt',5,'image/png')).status,415)
 assert.equal((await init(c,'big.bin',5*1048576)).status,413)
 // Resume across a server restart. Reservations apply before any bytes arrive.
 let r=await init(c,'transfer.bin',3*1048576);assert.equal(r.status,201);const upload=await r.json()
 assert.equal((await init(c,'room-full.bin',3*1048576)).status,413)
 const offsetChunk=Buffer.alloc(1048576,37)
 r=await req(`/api/${c}/uploads/${upload.id}`,'PATCH',offsetChunk,false,{'content-type':'application/octet-stream','upload-offset':'0'});assert.equal(r.status,200);assert.equal((await r.json()).offset,1048576)
 assert.equal((await req(`/api/${c}/uploads/${upload.id}`,'PATCH',offsetChunk,false,{'content-type':'application/octet-stream','upload-offset':'0'})).status,409,'duplicate offset rejected')
 assert.equal((await req(`/api/${c}/uploads/${upload.id}/complete`,'POST')).status,409,'cannot publish partial file')
 await running.stop();running=await start()
 assert.equal((await req('/api/1','GET',undefined,true)).status,401,'restart revokes sessions')
 const state=await(await req(`/api/${c}/uploads/${upload.id}`)).json();assert.equal(state.offset,1048576,'resume metadata survives restart')
 for(const offset of [1048576,2*1048576]){r=await req(`/api/${c}/uploads/${upload.id}`,'PATCH',offsetChunk,false,{'content-type':'application/octet-stream','upload-offset':String(offset)});assert.equal(r.status,200)}
 r=await req(`/api/${c}/uploads/${upload.id}/complete`,'POST');assert.equal(r.status,201);const file=await r.json()
 assert.equal((await req(`/api/${c}/uploads/${upload.id}/complete`,'POST')).status,201,'finish is idempotent')
 r=await req(`/api/${c}/file/${file.id}`,'GET',undefined,false,{range:'bytes=1048576-1048590'});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,15);assert.match(r.headers.get('content-disposition'),/attachment/)
 r=await req(`/api/${c}/file/${file.id}`,'HEAD');assert.equal(r.status,200);assert.equal(Number(r.headers.get('content-length')),3*1048576);assert.equal((await r.arrayBuffer()).byteLength,0)
 assert.equal((await req(`/api/${c}/file/${file.id}`,'GET',undefined,false,{range:'bytes=999999999-'})).status,416)
 assert.equal((await req(`/api/${c}/file/${file.id}`,'GET',undefined,false,{range:'bytes=-0'})).status,416)
 r=await req(`/api/${c}/file/${file.id}`);const hash=crypto.createHash('sha256');for await(const b of r.body)hash.update(b);assert.equal(hash.digest('hex'),crypto.createHash('sha256').update(Buffer.alloc(3*1048576,37)).digest('hex'),'streamed bytes match')
 r=await init(other,'reserve.bin',4*1048576-128);assert.equal(r.status,201);const reserve=await r.json()
 assert.equal((await init(other,'global-full.bin',129)).status,507,'global pending reservations enforced')
 await req(`/api/${other}/uploads/${reserve.id}`,'DELETE')
 // MIME, signature and traversal checks; binaries are always downloaded, never executed.
 r=await init(other,'fake.png',3,'image/png');const bad=await r.json();await req(`/api/${other}/uploads/${bad.id}`,'PATCH',Buffer.from('bad'),false,{'content-type':'application/octet-stream','upload-offset':'0'});assert.equal((await req(`/api/${other}/uploads/${bad.id}/complete`,'POST')).status,415);await req(`/api/${other}/uploads/${bad.id}`,'DELETE')
 assert.equal((await req('/api/..%2f..%2fetc')).status,404)
 for(const u of ['/.env','/.git/config','/assets/index.js.map','/server/security.js'])assert.equal((await req(u)).status,404)
 // Public installation icons must work without a session, including Apple's conventional paths.
 if(fs.existsSync('web/dist/apple-touch-icon.png'))for(const url of ['/apple-touch-icon.png','/apple-touch-icon-precomposed.png','/apple-touch-icon-180x180.png','/apple-touch-icon-v3.png']){
  const icon=await req(url);assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/image\/png/);assert.match(icon.headers.get('cache-control'),/public/);const meta=await sharp(Buffer.from(await icon.arrayBuffer())).metadata();assert.equal(meta.width,180);assert.equal(meta.channels,3)
 }
 if(fs.existsSync('web/dist/apple-touch-icon.png')){
  const icon=await req('/apple-touch-icon.png','GET',undefined,false,{origin:'null'});assert.equal(icon.status,200);assert.equal(icon.headers.get('access-control-allow-origin'),'*')
  for(const url of ['/api/session','/instalar.html','/1','/assets/foreign.js'])assert.equal((await req(url,'GET',undefined,false,{origin:'null'})).status,403,'opaque Origin remains denied outside exact public icons')
 }
 if(fs.existsSync('web/dist/passagem-logo.png')){
  const icon=await req('/passagem-logo.png');assert.equal(icon.status,200);const etag=icon.headers.get('etag');assert.ok(etag);assert.equal(icon.headers.get('accept-ranges'),'bytes');assert.ok(icon.headers.get('last-modified'))
  assert.equal((await req('/passagem-logo.png','GET',undefined,false,{'if-none-match':etag})).status,304)
  const range=await req('/passagem-logo.png','GET',undefined,false,{range:'bytes=0-31'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32)
  const manifest=await req('/manifest.webmanifest','GET',undefined,false,{origin:'null'});assert.equal(manifest.status,200);assert.equal((await manifest.json()).start_url,'/')
 }
 const health=await req('/health');assert.equal(health.status,200);assert.equal(health.headers.get('x-content-type-options'),'nosniff');assert.equal(health.headers.get('x-frame-options'),'DENY');assert.ok(health.headers.get('content-security-policy'));assert.equal(health.headers.get('cache-control'),'no-store')
 await login()
 assert.ok((await(await req('/api/1','GET',undefined,true)).json()).items.some(i=>i.id===privateText.id),'private room persists')
 await req('/api/1/item/'+privateText.id,'DELETE',undefined,true)
 assert.equal((await req('/api/rooms/1','DELETE',undefined,true)).status,400,'private room cannot be closed')
 assert.equal((await req('/api/rooms/'+c,'DELETE',undefined,true)).status,200)
 assert.equal((await req('/api/'+c)).status,404,'closed shared link revoked')
 assert.equal((await req('/api/logout','POST',undefined,true)).status,200)
 assert.equal((await req('/api/1','GET',undefined,true)).status,401,'logout invalidates server session')
 // Individual expiration does not reset when another item arrives.
 await login()
 const expRoom=await create()
 const first=await(await req(`/api/${expRoom}/text`,'POST',{text:'old'})).json()
 const second=await(await req(`/api/${expRoom}/text`,'POST',{text:'new'})).json()
 const expire=(room,item)=>{const name=path.join(DATA,room,item.id+'.json');const value=JSON.parse(fs.readFileSync(name,'utf8'));value.at=Date.now()-25*3600e3;fs.writeFileSync(name,JSON.stringify(value))}
 expire(expRoom,first)
 r=await req('/api/'+expRoom);assert.equal(r.status,200);assert.deepEqual((await r.json()).items.map(i=>i.id),[second.id])
 expire(expRoom,second);assert.equal((await req('/api/'+expRoom)).status,404,'room closes only after its last item expires')
 await login()
 const privateExp=await(await req('/api/1/text','POST',{text:'expire-private'},true)).json();expire('1',privateExp)
 r=await req('/api/1','GET',undefined,true);assert.equal(r.status,200);assert.equal((await r.json()).items.length,0,'private room survives empty')
 const photoRoom=await create()
 const png=await sharp({create:{width:96,height:64,channels:3,background:{r:112,g:82,b:205}}}).png().toBuffer()
 const picture=await(await init(photoRoom,'picture.png',png.length,'image/png')).json()
 assert.equal((await req(`/api/${photoRoom}/uploads/${picture.id}`,'PATCH',png,false,{'content-type':'application/octet-stream','upload-offset':'0'})).status,200)
 assert.equal((await req(`/api/${photoRoom}/uploads/${picture.id}/complete`,'POST')).status,201)
 r=await req(`/api/${photoRoom}/thumbnail/${picture.id}`);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/webp');assert.equal((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).width,96)
 assert.equal((await req('/api/1/thumbnail/'+picture.id)).status,401,'private thumbnail needs auth')
 r=await req(`/api/${photoRoom}/item/${picture.id}`,'DELETE');assert.equal(r.status,200);assert.equal((await r.json()).roomClosed,true)
 assert.equal((await req('/api/'+photoRoom)).status,404);assert.equal(fs.existsSync(path.join(DATA,photoRoom)),false,'delete removes original and thumbnail')
 await req('/api/logout','POST',undefined,true)
 // Concurrent brute-force and forged forwarding headers cannot bypass lockout.
 const attempts=await Promise.all(Array.from({length:10},(_,i)=>req('/api/login','POST',{pin:'bad'},false,{'cf-connecting-ip':`198.51.100.${i}`,'x-forwarded-for':`198.51.100.${i}`})))
 assert.equal(attempts.filter(x=>x.status===401).length,5);assert.ok(attempts.filter(x=>x.status===429).length>=5)
 r=await req('/api/login','POST',{pin:testPin});assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0)
 await running.stop();running=await start();assert.equal((await req('/api/login','POST',{pin:testPin})).status,429,'lockout survives restart')
 const audit=fs.readFileSync(path.join(DATA,'.security','audit.jsonl'),'utf8');assert.ok(!audit.includes(testPin));assert.ok(!audit.includes('private-only'));assert.ok(!audit.includes(c),'no bearer links in logs')
 let previous='';for(const line of audit.trim().split('\n')){const {hash,...entry}=JSON.parse(line);assert.equal(entry.prev,previous);assert.equal(hash,crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex'));previous=hash}
 console.log('OK: private room, owner-only rooms, sessions, CSRF/origin, concurrent/persistent lockout, quotas, chunk resume/restart, integrity, streamed ranges, uploads and audit.')
}finally{await running.stop();fs.rmSync(DATA,{recursive:true,force:true})}
// Short session expiration on an isolated instance.
const expData=fs.mkdtempSync(path.join(os.tmpdir(),'passagem-expiry-'));running=await start({DATA_DIR:expData,SESSION_HOURS:'0.00005'})
try{await login();await delay(250);assert.equal((await req('/api/1','GET',undefined,true)).status,401)}finally{await running.stop();fs.rmSync(expData,{recursive:true,force:true})}
console.log('OK: session expiration.')
