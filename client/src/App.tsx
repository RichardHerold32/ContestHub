import { useEffect, useState } from 'react'

type ConnectionStatus = 'loading' | 'connected' | 'error'

const statusMessage: Record<ConnectionStatus, string> = {
  loading: 'Checking the API connection…',
  connected: 'Connected to the ContestHub API.',
  error: 'Could not connect to the ContestHub API.',
}

function App() {
  const [status, setStatus] = useState<ConnectionStatus>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function checkConnection() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Health check returned HTTP ${response.status}`)
        }

        const result: unknown = await response.json()
        if (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'ok') {
          throw new Error('Unexpected health check response')
        }

        if (!controller.signal.aborted) {
          setStatus('connected')
        }
      } catch {
        if (!controller.signal.aborted) {
          setStatus('error')
        }
      }
    }

    void checkConnection()
    return () => controller.abort()
  }, [attempt])

  function retry() {
    setStatus('loading')
    setAttempt((previous) => previous + 1)
  }

  return (
    <main>
      <h1>ContestHub</h1>
      <p role="status">{statusMessage[status]}</p>
      {status === 'error' && (
        <button type="button" onClick={retry}>
          Retry
        </button>
      )}
    </main>
  )
}

export default App
