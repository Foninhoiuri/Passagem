import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import sharp from 'sharp'
const data=fs.mkdtempSync(path.join(os.tmpdir(),'passagem-pdf-'))
process.env.DATA_DIR=data;process.env.ADMIN_PIN='fixture-only';process.env.PUBLIC_ORIGIN='https://example.invalid';process.env.MIN_FREE_MB='0'
try{
 const{thumbnail}=await import('./thumbnails.js'),{documentPreview}=await import('./previews.js'),{removeItem}=await import('./storage.js')
 const id='c'.repeat(32),body=fs.readFileSync(path.join(import.meta.dirname,'fixtures/document.pdf'))
 const bin=path.join(data,'1',id+'.bin'),meta=path.join(data,'1',id+'.json');fs.writeFileSync(bin,body);fs.writeFileSync(meta,JSON.stringify({id,kind:'file',name:'documento.pdf',size:body.length,at:Date.now()}))
 const info=await documentPreview('1',id);assert.equal(info.pages,2)
 const first=await thumbnail('1',id),m=await sharp(first).metadata();assert.equal(m.format,'webp');assert.ok(m.width<=960&&m.height<=960)
 const second=await thumbnail('1',id,2);assert.ok(Buffer.isBuffer(second));assert.notEqual(crypto.createHash('sha256').update(second).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(first)).digest('hex'))
 assert.equal(fs.readdirSync(path.join(data,'1')).filter(n=>n.includes('-p2')).length,0,'extra pages are transient')
 await assert.rejects(thumbnail('1',id,3),e=>e.status===404);await assert.rejects(thumbnail('1',id,0),e=>e.status===400)
 const broken='d'.repeat(32);fs.writeFileSync(path.join(data,'1',broken+'.bin'),'%PDF-1.4 invalid');fs.writeFileSync(path.join(data,'1',broken+'.json'),JSON.stringify({id:broken,kind:'file',name:'corrompido.pdf',size:16,at:Date.now()}));await assert.rejects(documentPreview('1',broken),e=>e.status===422);await assert.rejects(thumbnail('1',broken),e=>e.status===404);removeItem('1',broken)
 removeItem('1',id);assert.ok(!fs.existsSync(first),'deletion removes PDF thumbnail');assert.ok(fs.existsSync(path.join(data,'1')))
 console.log('OK: PDF real com2páginas, metadados, páginas distintas, erros controlados, páginas adicionais transitórias e miniatura removida com original.')
}finally{fs.rmSync(data,{recursive:true,force:true})}
