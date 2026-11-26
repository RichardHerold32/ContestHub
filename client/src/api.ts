export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function apiRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: 'same-origin', ...init })
  if (response.ok) return response

  const body = await response.json().catch(() => undefined)
  const message = body?.error?.message
  throw new ApiError(response.status, typeof message === 'string' ? message : `Request failed (HTTP ${response.status}).`)
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiRequest(path, init)).json()
}

export function jsonBody(body: object): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
