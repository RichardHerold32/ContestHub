import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { ApiError, apiJson } from './api'

export type User = {
  id: string
  name: string
  email: string
  role: 'USER' | 'ADMIN'
}

const sessionKey = ['session'] as const
export const bookmarksKey = ['bookmarks'] as const
export const adminContestsKey = ['admin-contests'] as const
const privateQueries = {
  predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === bookmarksKey[0] || queryKey[0] === adminContestsKey[0],
}

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal, client }) => {
      let user: User | null
      try {
        const result = await apiJson<{ user: User }>('/api/auth/me', { signal, cache: 'no-store' })
        user = result.user
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error
        user = null
      }

      const previous = client.getQueryData<User | null>(sessionKey)
      if (!signal.aborted && previous?.id !== user?.id) {
        client.removeQueries(privateQueries)
      } else if (!signal.aborted && previous?.role === 'ADMIN' && user?.role !== 'ADMIN') {
        client.removeQueries({ queryKey: adminContestsKey })
      }
      return user
    },
    retry: false,
  })
}

export async function setSession(client: QueryClient, user: User | null) {
  await client.cancelQueries({ queryKey: sessionKey })
  await client.cancelQueries(privateQueries)
  client.removeQueries(privateQueries)
  client.setQueryData(sessionKey, user)
}

export function recheckSession(client: QueryClient) {
  return client.invalidateQueries({ queryKey: sessionKey })
}
