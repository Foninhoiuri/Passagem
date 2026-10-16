export async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.append(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    if (!ok) throw new Error('Não foi possível copiar. Selecione o texto e copie manualmente.')
  }
}
