let csrfToken = ''
export function setCsrf(token = '') { csrfToken = token }
export function requestHeaders(extra: Record<string, string> = {}) { return { 'x-passagem-client': '1', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...extra } }
export class ApiError extends Error {
  status: number
  retryAfter: number
  constructor(message: string, status: number, retryAfter = 0) { super(message); this.status = status; this.retryAfter = retryAfter }
}
export async function api(path: string, options: RequestInit = {}) {
  const r = await fetch(path, { ...options, credentials: 'same-origin', headers: { ...requestHeaders(), ...options.headers } })
  let data
  try { data = await r.json() } catch { throw new ApiError('O servidor não respondeu como esperado. Tente novamente.', r.status) }
  if (!r.ok) throw new ApiError(data.erro || 'Não foi possível concluir. Tente novamente.', r.status, Number(r.headers.get('retry-after') || data.retryAfter || 0))
  return data
}
