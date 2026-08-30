'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert } from '@/components/Alert'
import { ApiError, getAuthStatus, login, loginTwoFactor, navigation } from '@/lib/api'

const inputClass =
  'w-full px-3 py-2 text-sm rounded-[7px] bg-surface border border-border text-text-primary focus:outline-none'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getAuthStatus()
      .then((status) => {
        if (status.mode !== 'native' || status.authenticated) router.replace('/')
        else if (status.setup_required) router.replace('/setup')
      })
      .catch(() => {})
  }, [router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (pendingToken) {
        await loginTwoFactor(pendingToken, code)
        navigation.toHome()
        return
      }
      const result = await login(email, password)
      if (result.pending && result.pending_token) {
        setPendingToken(result.pending_token)
        return
      }
      navigation.toHome()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && pendingToken) {
        setError(err.message)
        // an expired or exhausted pending token means starting over; a wrong
        // code leaves the token usable, so stay on the code step
        if (err.code === 'pending_login_invalid') {
          setPendingToken(null)
          setCode('')
        }
      } else {
        setError(err instanceof ApiError ? err.message : 'login failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <div className="glass-card p-6">
        <h1 className="text-base font-semibold text-text-primary mb-1">Log in</h1>
        <p className="text-xs text-text-muted mb-4">
          {pendingToken
            ? 'Enter a code from your authenticator app, or a backup code.'
            : 'Sign in to your Tracefinity account.'}
        </p>
        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          {pendingToken ? (
            <input
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoComplete="one-time-code"
              autoFocus
              aria-label="Two-factor code"
            />
          ) : (
            <>
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="username"
                required
                aria-label="Email"
              />
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
                aria-label="Password"
              />
            </>
          )}
          <button type="submit" disabled={busy} className="btn-primary w-full py-2 text-sm">
            {pendingToken ? 'Verify' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
