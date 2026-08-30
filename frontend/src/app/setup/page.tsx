'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert } from '@/components/Alert'
import { ApiError, getAuthStatus, navigation, setupAdmin } from '@/lib/api'

const inputClass =
  'w-full px-3 py-2 text-sm rounded-[7px] bg-surface border border-border text-text-primary focus:outline-none'

export default function SetupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getAuthStatus()
      .then((status) => {
        if (status.mode !== 'native') router.replace('/')
        else if (!status.setup_required) router.replace(status.authenticated ? '/' : '/login')
      })
      .catch(() => {})
  }, [router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('passwords do not match')
      return
    }
    setBusy(true)
    try {
      await setupAdmin(email, password)
      navigation.toHome()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'setup failed')
      setBusy(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <div className="glass-card p-6">
        <h1 className="text-base font-semibold text-text-primary mb-1">Welcome to Tracefinity</h1>
        <p className="text-xs text-text-muted mb-4">
          Create the administrator account for this installation. Any existing data on this
          instance becomes yours.
        </p>
        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
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
            placeholder="Password (at least 8 characters)"
            autoComplete="new-password"
            minLength={8}
            required
            aria-label="Password"
          />
          <input
            className={inputClass}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            required
            aria-label="Confirm password"
          />
          <button type="submit" disabled={busy} className="btn-primary w-full py-2 text-sm">
            Create administrator
          </button>
        </form>
      </div>
    </div>
  )
}
