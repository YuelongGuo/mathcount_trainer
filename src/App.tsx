import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { auth } from './firebase'
import type { AuthResponse, AuthStatusResponse, BackgroundMessage } from './messages'

const sendMessage = <T extends BackgroundMessage, R>(message: T) =>
  new Promise<R>((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('Extension runtime not available'))
      return
    }

    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(runtimeError)
        return
      }
      resolve(response as R)
    })
  })

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const response = await sendMessage<BackgroundMessage, AuthResponse>({ type: 'AUTH_STATUS' })
      if (response.ok) {
        setAuthStatus(response.status)
        setError(null)
      } else {
        setError(response.error)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach extension service'
      setError(message)
    }
  }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      setError('Extension APIs not available. Load this UI as a Chrome extension.')
      return
    }

    refreshStatus()

    const handleStorageChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      areaName,
    ) => {
      if (areaName !== 'local') {
        return
      }

      if (changes.authState || changes.queuedProblemLogs) {
        refreshStatus()
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [refreshStatus])

  const getExtensionOrigin = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      return `chrome-extension://${chrome.runtime.id}`
    }
    return 'chrome-extension://<your-extension-id>'
  }

  const formatAuthError = (err: unknown, fallback: string) => {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code?: string }).code
      if (code === 'auth/unauthorized-domain') {
        return `Unauthorized domain. Add ${getExtensionOrigin()} to Firebase Auth > Authorized domains.`
      }
    }
    if (err instanceof Error) {
      return err.message
    }
    return fallback
  }

  const handleGoogleSignIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, provider)
      await refreshStatus()
    } catch (err) {
      setError(formatAuthError(err, 'Sign-in failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    setBusy(true)
    setError(null)
    try {
      await signOut(auth)
      await refreshStatus()
    } catch (err) {
      setError(formatAuthError(err, 'Sign-out failed'))
    } finally {
      setBusy(false)
    }
  }

  const isSignedIn = authStatus?.status === 'signed_in'
  const queuedCount = authStatus?.queuedCount ?? 0
  const statusLabel = authStatus
    ? isSignedIn
      ? 'Signed in'
      : 'Signed out'
    : 'Checking status...'

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">MathCounts Trainer</p>
          <h1>Wrong Answer Log</h1>
        </div>
        <span className={`status-pill ${isSignedIn ? 'is-on' : 'is-off'}`}>{statusLabel}</span>
      </header>

      <section className="status-card">
        <p className="status-line">
          {isSignedIn && authStatus?.status === 'signed_in'
            ? `Signed in as ${authStatus.email ?? 'unknown'}`
            : 'Sign in to sync your logs'}
        </p>
        <p className="status-subline">
          {queuedCount === 0
            ? 'All caught up'
            : `${queuedCount} log${queuedCount === 1 ? '' : 's'} queued for sync`}
        </p>
      </section>

      {!isSignedIn ? (
        <div className="auth-form">
          <button className="primary" type="button" onClick={handleGoogleSignIn} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>
      ) : (
        <div className="button-row">
          <button className="secondary" type="button" onClick={handleSignOut} disabled={busy}>
            Sign out
          </button>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}

      <section className="helper">
        <p>
          Open the AoPS MathCounts Trainer and keep practicing. This extension will log incorrect
          answers in the background.
        </p>
      </section>
    </div>
  )
}

export default App
