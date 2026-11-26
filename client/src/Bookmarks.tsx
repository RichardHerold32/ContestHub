import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ApiError, apiJson, apiRequest, jsonBody } from './api'
import { ContestLabels, ContestSchedule, OrganiserLink } from './ContestSummary'
import type { Contest } from './contests'
import { bookmarksKey, recheckSession, setSession, useSession } from './session'

const endpoint = '/api/me/bookmarks'
type SavedContest = { savedAt: string; contest: Contest }
class AccountChanged extends Error {}

function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401
}

function useBookmarks(userId: string) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: [...bookmarksKey, userId],
    queryFn: async ({ signal }) => {
      const data = await apiJson<{ userId: string; items: SavedContest[] }>(endpoint, { signal, cache: 'no-store' })
      if (data.userId !== userId) throw new AccountChanged('Your session changed.')
      return data.items
    },
    retry: false,
  })
  const unauthorized = isUnauthorized(query.error)
  const accountChanged = query.error instanceof AccountChanged

  useEffect(() => {
    if (unauthorized) void setSession(client, null)
    else if (accountChanged) void recheckSession(client)
  }, [accountChanged, client, unauthorized])

  return { ...query, hidden: unauthorized || accountChanged }
}

function BookmarkButton({ contest, userId, saved }: { contest: Contest; userId: string; saved: boolean }) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => saved
      ? apiRequest(`${endpoint}/${encodeURIComponent(contest.id)}`, { method: 'DELETE' })
      : apiRequest(endpoint, { method: 'POST', ...jsonBody({ contestId: contest.id }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...bookmarksKey, userId] }),
    onError: async (error) => {
      if (isUnauthorized(error)) await setSession(client, null)
    },
  })

  return (
    <div className="bookmark-action">
      <button className={saved ? 'button' : 'button button--primary'} type="button"
        aria-label={saved ? `Remove bookmark for ${contest.title}` : `Save bookmark for ${contest.title}`}
        onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? (saved ? 'Removing…' : 'Saving…') : (saved ? 'Remove bookmark' : 'Save bookmark')}
      </button>
      {mutation.isError && (
        <p role="alert" className="action-error">
          {mutation.error instanceof ApiError && mutation.error.status === 404
            ? 'This contest is no longer available.'
            : saved ? 'Could not remove the bookmark. Try again.' : 'Could not save the bookmark. Try again.'}
        </p>
      )}
    </div>
  )
}

function QueryRetry({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="notice notice--error">
      <p role="alert">{text}</p>
      <button type="button" className="button" onClick={retry}>Retry</button>
    </div>
  )
}

function DetailBookmark({ contest, userId }: { contest: Contest; userId: string }) {
  const query = useBookmarks(userId)
  if (query.isPending || query.hidden) return <p role="status">Checking bookmarks…</p>
  if (query.isError) {
    return <QueryRetry text="Could not check bookmarks." retry={() => void query.refetch()} />
  }
  return <BookmarkButton contest={contest} userId={userId} saved={Boolean(query.data?.some((item) => item.contest.id === contest.id))} />
}

export function ContestBookmark({ contest }: { contest: Contest }) {
  const session = useSession()
  const location = useLocation()
  if (session.isPending) return <p role="status">Checking session…</p>
  if (session.isError) return <QueryRetry text="Could not check your session." retry={() => void session.refetch()} />
  if (!session.data) return <Link to="/auth" state={{ returnTo: location.pathname + location.search }}>Sign in to bookmark</Link>

  return <DetailBookmark key={session.data.id} contest={contest} userId={session.data.id} />
}

function BookmarkList({ userId }: { userId: string }) {
  const query = useBookmarks(userId)
  if (query.isPending || query.hidden) return <p role="status">Loading bookmarks…</p>

  return (
    <>
      {query.isError && <QueryRetry text="Could not load bookmarks." retry={() => void query.refetch()} />}
      {query.data?.length === 0 && (
        <div className="notice"><h2>No bookmarks yet</h2><p>Save a contest from its detail page.</p><Link to="/">Explore contests</Link></div>
      )}
      {query.data && query.data.length > 0 && (
        <ul className="contest-grid">
          {query.data.map(({ contest }) => (
            <li className="contest-card" key={contest.id}>
              <ContestLabels contest={contest} />
              <h3><Link to={`/contests/${encodeURIComponent(contest.id)}`}>{contest.title}</Link></h3>
              <p className="category">{contest.category}</p>
              <ContestSchedule contest={contest} />
              <OrganiserLink contest={contest} />
              <BookmarkButton contest={contest} userId={userId} saved />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function BookmarksPage() {
  const session = useSession()
  if (session.isSuccess && !session.data) return <Navigate replace to="/auth" state={{ returnTo: '/bookmarks' }} />

  return (
    <>
      <section className="intro bookmarks-intro"><h1>My bookmarks</h1></section>
      {session.isPending && <p role="status">Checking session…</p>}
      {session.isError && <QueryRetry text="Could not check your session." retry={() => void session.refetch()} />}
      {session.isSuccess && session.data && <BookmarkList key={session.data.id} userId={session.data.id} />}
    </>
  )
}
