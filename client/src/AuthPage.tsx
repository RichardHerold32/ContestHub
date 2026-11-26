import { useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, apiJson, apiRequest, jsonBody } from './api'
import { setSession, useSession } from './session'
import type { User } from './session'

export function SessionNav() {
  const session = useSession()
  const client = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const authState = { returnTo: location.pathname + location.search }

  async function signOut() {
    setPending(true)
    setError('')
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
      await setSession(client, null)
      if (location.pathname === '/bookmarks') navigate('/auth', { replace: true, state: authState })
    } catch {
      setError('Could not sign out. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <nav className="account-nav" aria-label="Account">
      <Link to="/bookmarks">My bookmarks</Link>
      {session.data?.role === 'ADMIN' && <Link to="/admin/contests">Admin contests</Link>}
      {session.data ? (
        <button className="button" type="button" disabled={pending} onClick={() => void signOut()}>
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
      ) : !session.isPending && location.pathname !== '/auth' && (
        <Link className="button" to="/auth" state={authState}>Sign in</Link>
      )}
      {error && <p role="alert" className="action-error">{error}</p>}
    </nav>
  )
}

function returnPath(target: unknown) {
  if (typeof target !== 'string') return '/'
  const [path] = target.split('?')
  return path === '/bookmarks' || path === '/admin/contests' || path === '/' || /^\/contests\/[\w%.-]+$/.test(path) ? target : '/'
}

export function AuthPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const [registering, setRegistering] = useState(false)
  const [pending, setPending] = useState(false)
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const destination = returnPath(location.state?.returnTo)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    setNotice('')
    try {
      const credentials = { email, password: String(form.get('password')) }
      if (registering) {
        await apiRequest('/api/auth/register', { method: 'POST', ...jsonBody({ ...credentials, name: String(form.get('name')) }) })
        setRegistering(false)
        setNotice('Account created. Sign in to continue.')
      } else {
        const { user } = await apiJson<{ user: User }>('/api/auth/login', { method: 'POST', ...jsonBody(credentials) })
        await setSession(client, user)
        navigate(destination, { replace: true })
      }
    } catch (failure) {
      const fallback = registering ? 'Could not create your account. Please try again.' : 'Could not sign in. Please try again.'
      setError(failure instanceof ApiError && failure.status < 500 ? failure.message : fallback)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="detail auth-panel">
      <h1>{registering ? 'Create an account' : 'Sign in'}</h1>
      {session.data ? (
        <p className="auth-message">Signed in as {session.data.name}. <Link to={destination}>Continue</Link></p>
      ) : (
        <>
          {notice && <p className="auth-message" role="status">{notice}</p>}
          <form key={String(registering)} className="auth-form" onSubmit={(event) => void submit(event)}>
            {registering && <label>Name<input name="name" autoComplete="name" maxLength={120} required /></label>}
            <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>
              Password
              <input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'}
                minLength={registering ? 12 : undefined} maxLength={128} required />
            </label>
            {registering && <p className="category">Use at least 12 characters.</p>}
            {error && <p role="alert" className="action-error">{error}</p>}
            <button className="button button--primary" disabled={pending}>
              {pending ? 'Submitting…' : registering ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <button className="button auth-switch" type="button" disabled={pending} onClick={() => {
            setRegistering(!registering)
            setError('')
            setNotice('')
          }}>{registering ? 'Back to sign in' : 'Create an account'}</button>
        </>
      )}
    </section>
  )
}
