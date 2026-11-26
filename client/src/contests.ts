import { queryOptions } from '@tanstack/react-query'
import { ApiError, apiJson } from './api'

export type Contest = {
  id: string
  title: string
  description: string | null
  category: string
  source: 'CODEFORCES' | 'MANUAL'
  startsAt: string
  endsAt: string | null
  sourceUrl: string
  status: 'upcoming' | 'live' | 'ended'
}

type ContestPage = {
  items: Contest[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export function readFilters(params: URLSearchParams) {
  const text = (name: string) => (params.get(name) ?? '').replaceAll('\u0000', '').trim()
  const source = params.get('source')
  const upcoming = params.get('upcoming')
  const sort = params.get('sort')
  const pageParam = params.get('page') ?? ''
  const page = Number(pageParam)

  return {
    search: text('search'),
    category: text('category'),
    source: source === 'CODEFORCES' || source === 'MANUAL' ? source : '',
    upcoming: upcoming === 'true' || upcoming === 'false' ? upcoming : '',
    sort: sort === 'start-asc' || sort === 'start-desc' ? sort : '',
    page: /^[0-9]+$/.test(pageParam) && Number.isSafeInteger(page) && page > 0 ? page : 1,
  } as const
}

export type Filters = ReturnType<typeof readFilters>

export function filterParams(filters: Filters) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === 'page' && value === 1)) params.set(key, String(value))
  }
  return params
}

const refresh = {
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  retry: (failures: number, error: Error) => failures < 1 &&
    (!(error instanceof ApiError) || error.status === 429 || error.status >= 500),
}

export function contestListQuery(filters: Filters) {
  const params = filterParams(filters)
  params.set('limit', '12')
  return queryOptions({
    queryKey: ['contests', filters],
    queryFn: ({ signal }) => apiJson<ContestPage>(`/api/contests?${params}`, { signal, cache: 'no-cache' }),
    ...refresh,
  })
}

export function contestDetailQuery(id: string) {
  return queryOptions({
    queryKey: ['contest', id],
    queryFn: ({ signal }) => apiJson<Contest>(`/api/contests/${encodeURIComponent(id)}`, { signal, cache: 'no-cache' }),
    ...refresh,
  })
}
