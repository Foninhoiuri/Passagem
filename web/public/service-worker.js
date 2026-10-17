// Only public installation assets are cached. Never cache APIs, room links or files.
const CACHE='passagem-public-v3'
const PUBLIC=['/offline.html','/manifest.webmanifest','/favicon.svg','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png','/icons/apple-touch-icon.png']
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC)).then(()=>self.skipWaiting()))})
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('passagem-public-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))})
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url)
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')));return}
 if(PUBLIC.includes(url.pathname)){event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));return}
 // Room addresses and dynamic content are deliberately not stored offline.
})
