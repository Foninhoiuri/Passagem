// Public installation assets only: provide the same HTTP validators/ranges as nginx.
import fs from 'node:fs'
import crypto from 'node:crypto'
export function sendPublicIcon(req,res,file){
 const bytes=fs.readFileSync(file),stat=fs.statSync(file),etag='"'+crypto.createHash('sha256').update(bytes).digest('hex')+'"',modified=stat.mtime.toUTCString()
 res.setHeader('ETag',etag);res.setHeader('Last-Modified',modified);res.setHeader('Accept-Ranges','bytes')
 const tags=String(req.headers['if-none-match']||'').split(',').map(s=>s.trim().replace(/^W\//,''))
 if(tags.includes(etag)||tags.includes('*')||(!req.headers['if-none-match']&&req.headers['if-modified-since']&&Date.parse(req.headers['if-modified-since'])>=Math.floor(stat.mtimeMs/1000)*1000)){res.statusCode=304;return res.end()}
 let start=0,end=bytes.length-1,status=200
 const range=req.headers.range,match=/^bytes=(\d*)-(\d*)$/.exec(range||'')
 const fresh=!req.headers['if-range']||req.headers['if-range']===etag||req.headers['if-range']===modified
 if(range&&fresh){
  if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});return res.end()}
  if(!match[1])start=Math.max(0,bytes.length-Number(match[2]));else start=Number(match[1])
  if(match[1]&&match[2])end=Math.min(end,Number(match[2]))
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length||(!match[1]&&Number(match[2])===0)){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});return res.end()}
  status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`)
 }
 res.statusCode=status;res.setHeader('Content-Length',end-start+1)
 return res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1))
}
