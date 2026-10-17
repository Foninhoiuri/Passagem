import { useEffect, useState } from 'react'
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{outcome:string}> }
export function PwaInstall() {
 const [prompt,setPrompt] = useState<InstallEvent | null>(null)
 const [installed,setInstalled] = useState(false)
 useEffect(()=>{
  const standalone = matchMedia('(display-mode: standalone)')
  setInstalled(standalone.matches || Boolean((navigator as Navigator & {standalone?:boolean}).standalone))
  const offer=(e:Event)=>{e.preventDefault();setPrompt(e as InstallEvent)}
  const done=()=>{setInstalled(true);setPrompt(null)}
  window.addEventListener('beforeinstallprompt',offer);window.addEventListener('appinstalled',done)
  return()=>{window.removeEventListener('beforeinstallprompt',offer);window.removeEventListener('appinstalled',done)}
 },[])

 return <details className="text-center text-xs text-tertiary"><summary className="cursor-pointer font-medium text-brand-secondary">{installed ? 'Aplicativo instalado' : 'Instalar o Passagem'}</summary>{installed?<p className="mt-2">Para atualizar, feche e abra o Passagem. Se o ícone continuar antigo, remova somente o atalho e instale novamente pelo navegador. Os arquivos continuam na sua sala.</p>:prompt?<button type="button" className="mt-3 rounded-lg bg-brand-solid px-4 py-2 font-semibold text-white" onClick={async()=>{await prompt.prompt();await prompt.userChoice;setPrompt(null)}}>Instalar aplicativo</button>:<p className="mt-2">No iPhone: Compartilhar → Adicionar à Tela de Início.<br/>No Android ou computador: menu do navegador → Instalar aplicativo.</p>}</details>
}
