import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { error } from './security.js'
import { getFile, roomDir } from './storage.js'
sharp.concurrency(1)
sharp.cache({ memory: 32, files: 0, items: 16 })
let processing=0
const waiters=[]
const jobs=new Map()
async function acquire(){if(processing<2){processing++;return}if(waiters.length>=32)throw error(503,'Miniaturas ocupadas. Tente novamente.');await new Promise(resolve=>waiters.push(resolve))}
function release(){const next=waiters.shift();if(next)next();else processing--}
function raster(file){const fd=fs.openSync(file,'r'),b=Buffer.alloc(16);try{fs.readSync(fd,b,0,16,0)}finally{fs.closeSync(fd)}return b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||(b[0]===255&&b[1]===216)||/^GIF8[79]a/.test(b.toString('ascii'))||(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')||b.toString('ascii',4,12).includes('ftypavif')}
export async function thumbnail(c,id){
 const{item,file}=getFile(c,id)
 if(item.size>50*1048576||!/\.(png|jpe?g|gif|webp|avif)$/i.test(item.name)||!raster(file))throw error(404,'Miniatura indisponível para este arquivo.')
 const out=path.join(roomDir(c),'.thumb-'+id+'.webp')
 if(fs.existsSync(out))return out
 const key=c+':'+id
 if(!jobs.has(key)){
  const promise=(async()=>{
   await acquire();const tmp=out+'.'+crypto.randomBytes(8).toString('hex')+'.tmp'
   try{
    const disk=fs.statfsSync(roomDir(c));if(disk.bavail*disk.bsize<(Number(process.env.MIN_FREE_MB||2048)+2)*1048576)throw error(507,'Sem espaço para gerar a miniatura.')
    await sharp(file,{limitInputPixels:40e6,sequentialRead:true,animated:false,failOn:'warning'}).rotate().resize({width:640,height:480,fit:'inside',withoutEnlargement:true}).webp({quality:78}).timeout({seconds:5}).toFile(tmp)
    if(!fs.existsSync(file))throw error(404,'Arquivo não encontrado.')
    fs.chmodSync(tmp,0o600);fs.renameSync(tmp,out);return out
   }catch(e){fs.rmSync(tmp,{force:true});throw e.status?e:error(404,'Não foi possível gerar a miniatura deste arquivo.')}
   finally{release();jobs.delete(key)}
  })();jobs.set(key,promise)
 }
 return jobs.get(key)
}
