import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import { ApiError, apiJson, jsonBody } from './api'
import { adminContestsKey, bookmarksKey, recheckSession, setSession, useSession } from './session'

const endpoint = '/api/admin/contests'
type ContestFields = {
  title: string
  category: string
  description: string | null
  startsAt: string
  endsAt: string | null
  sourceUrl: string
  isPublished: boolean
}
type AdminContest = ContestFields & { id: string; updatedAt: string }

function localDateTime(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function parseLocalTime(label: string, input: string, original?: string | null) {
  if (original && input === localDateTime(original)) return original
  const date = new Date(input)
  if (!Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== input) {
    throw new Error(`Enter a valid ${label} in your time zone.`)
  }
  return date.toISOString()
}

function ContestForm({ contest, close, saved }: {
  contest?: AdminContest; close: () => void; saved: (updated: AdminContest) => void
}) {
  const client = useQueryClient()
  const [formError, setFormError] = useState('')
  const mutation = useMutation({
    mutationFn: (body: Partial<ContestFields>) => apiJson<AdminContest>(
      contest ? `${endpoint}/${encodeURIComponent(contest.id)}` : endpoint,
      { method: contest ? 'PATCH' : 'POST', ...jsonBody(body) },
    ),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: adminContestsKey }),
        client.invalidateQueries({ queryKey: ['contests'] }),
        client.invalidateQueries({ queryKey: ['contest', result.id] }),
        client.invalidateQueries({ queryKey: bookmarksKey }),
      ])
      saved(result)
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 401) await setSession(client, null)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    mutation.reset()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    try {
      const end = text('endsAt')
      const fields: ContestFields = {
        title: text('title'),
        category: text('category'),
        description: text('description') || null,
        startsAt: parseLocalTime('start time', text('startsAt'), contest?.startsAt),
        endsAt: end ? parseLocalTime('end time', end, contest?.endsAt) : null,
        sourceUrl: text('sourceUrl'),
        isPublished: form.has('isPublished'),
      }
      const body = contest ? Object.fromEntries(
        Object.entries(fields).filter(([key, value]) => value !== contest[key as keyof ContestFields]),
      ) : fields
      if (Object.keys(body).length === 0) {
        setFormError('There are no changes to save.')
        return
      }
      mutation.mutate(body)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Check the contest times.')
    }
  }

  const error = formError || (mutation.isError && (
    mutation.error instanceof ApiError && mutation.error.status < 500
      ? mutation.error.message
      : 'Could not save the contest. Try again.'
  ))
  return (
    <section className="detail admin-form-panel" aria-labelledby="contest-form-heading">
      <h2 id="contest-form-heading">{contest ? 'Edit contest' : 'Create contest'}</h2>
      <form className="auth-form" onSubmit={submit}>
        <fieldset className="admin-fields" disabled={mutation.isPending}>
          <label>Title<input name="title" defaultValue={contest?.title} maxLength={200} required /></label>
          <label>Category<input name="category" defaultValue={contest?.category ?? 'CODING'} maxLength={60} required /></label>
          <label>Description (optional)<textarea name="description" defaultValue={contest?.description ?? ''} maxLength={5000} rows={3} /></label>
          <label>Organiser URL<input name="sourceUrl" type="url" defaultValue={contest?.sourceUrl} maxLength={2048} required /></label>
          <p className="category">Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
          <label>Start time<input name="startsAt" type="datetime-local" defaultValue={contest ? localDateTime(contest.startsAt) : ''} required /></label>
          <label>End time (optional)<input name="endsAt" type="datetime-local" defaultValue={contest?.endsAt ? localDateTime(contest.endsAt) : ''} /></label>
          <label className="publication-control">
            <input name="isPublished" type="checkbox" role="switch" defaultChecked={contest?.isPublished ?? false} />
            Published
          </label>
          {error && <p role="alert" className="action-error">{error}</p>}
          <div className="detail-actions">
            <button className="button button--primary">{mutation.isPending ? 'Saving…' : 'Save contest'}</button>
            <button type="button" className="button" onClick={close}>Cancel</button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}

function AdminWorkspace({ userId }: { userId: string }) {
  const client = useQueryClient()
  const [form, setForm] = useState<AdminContest | 'new' | null>(null)
  const [notice, setNotice] = useState('')
  const list = useQuery({
    queryKey: [...adminContestsKey, userId],
    queryFn: ({ signal }) => apiJson<{ items: AdminContest[] }>(endpoint, { signal, cache: 'no-store' }),
    retry: false,
  })
  const status = list.error instanceof ApiError ? list.error.status : undefined
  useEffect(() => {
    if (status === 401) void setSession(client, null)
    if (status === 403) void recheckSession(client)
  }, [client, status])

  if (status === 401) return <p role="status">Checking your session…</p>
  if (status === 403) return <AccessDenied />

  return (
    <>
      <section className="intro bookmarks-intro"><h1>Admin contests</h1></section>
      <div className="admin-toolbar">
        <button className="button button--primary" disabled={form !== null} onClick={() => { setNotice(''); setForm('new') }}>
          Create contest
        </button>
        {notice && <p role="status">{notice}</p>}
      </div>
      {form && <ContestForm key={form === 'new' ? form : form.id} contest={form === 'new' ? undefined : form}
        close={() => setForm(null)} saved={(result) => {
          setForm(null)
          setNotice(result.isPublished ? 'Contest saved and published.' : 'Contest saved as unpublished.')
        }} />}
      {list.isPending && <p role="status">Loading contests…</p>}
      {list.isError && <LoadFailure message="Could not load curated contests." retry={() => void list.refetch()} />}
      {list.data?.items.length === 0 && <p className="notice">No curated contests yet.</p>}
      {list.data && list.data.items.length > 0 && (
        <ul className="contest-grid admin-list">
          {list.data.items.map((contest) => (
            <li className="contest-card" key={contest.id}>
              <span className={`status ${contest.isPublished ? 'status--upcoming' : 'status--ended'}`}>
                {contest.isPublished ? 'Published' : 'Unpublished'}
              </span>
              <h3>{contest.title}</h3>
              <p className="category">{contest.category}</p>
              <button className="button admin-edit" type="button" aria-label={`Edit ${contest.title}`} disabled={form !== null}
                onClick={() => { setNotice(''); setForm(contest) }}>Edit</button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function LoadFailure({ message, retry }: { message: string; retry: () => void }) {
  return <div className="notice notice--error">
    <p role="alert">{message}</p><button className="button" onClick={retry}>Retry</button>
  </div>
}

function AccessDenied() {
  return <section className="notice"><h1>Access denied</h1><p>Contest editing requires an admin account.</p><Link to="/">Explore contests</Link></section>
}

export function AdminContestsPage() {
  const session = useSession()
  if (session.isPending) return <p role="status">Checking your session…</p>
  if (session.isError) return <LoadFailure message="Could not check your session." retry={() => void session.refetch()} />
  if (!session.data) return <Navigate replace to="/auth" state={{ returnTo: '/admin/contests' }} />
  if (session.data.role !== 'ADMIN') return <AccessDenied />
  return <AdminWorkspace key={session.data.id} userId={session.data.id} />
}
