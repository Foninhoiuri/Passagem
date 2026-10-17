// Decode our own synthetic HEIC, not a JPEG renamed to .heic. Run inside the production image too.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'
const data=fs.mkdtempSync(path.join(os.tmpdir(),'passagem-heic-'))
process.env.DATA_DIR=data;process.env.ADMIN_PIN='fixture-only';process.env.PUBLIC_ORIGIN='https://example.invalid';process.env.MIN_FREE_MB='0'
try{
 const {thumbnail}=await import('./thumbnails.js')
 const id='a'.repeat(32),source=path.join(import.meta.dirname,'fixtures/transfer.heic'),body=fs.readFileSync(source)
 fs.writeFileSync(path.join(data,'1',id+'.bin'),body)
 fs.writeFileSync(path.join(data,'1',id+'.json'),JSON.stringify({id,kind:'file',name:'camera.HEIC',size:body.length,at:Date.now()}))
 const file=await thumbnail('1',id),meta=await sharp(file).metadata()
 assert.equal(meta.format,'webp');assert.ok(meta.width<=640&&meta.height<=480);assert.equal(meta.exif,undefined)
 assert.equal(await thumbnail('1',id),file,'cached result reused')
 fs.rmSync(file);fs.writeFileSync(path.join(data,'1',id+'.bin'),Buffer.concat([body.subarray(0,64),Buffer.alloc(20)]));await assert.rejects(thumbnail('1',id),e=>e.status===404,'corrupt HEIC fails safely')
 console.log('OK: HEIC real decodificado, reduzido e sem EXIF; cache reutilizado.')
}finally{fs.rmSync(data,{recursive:true,force:true})}
