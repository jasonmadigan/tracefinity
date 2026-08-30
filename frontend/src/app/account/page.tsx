'use client'

import { FormEvent, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert } from '@/components/Alert'
import {
  ApiError,
  changePassword,
  confirmTwoFactor,
  disableTwoFactor,
  enrollTwoFactor,
  getMe,
  regenerateBackupCodes,
} from '@/lib/api'
import type { TwoFactorEnrolment } from '@/types'

const inputClass =
  'w-full px-3 py-2 text-sm rounded-[7px] bg-surface border border-border text-text-primary focus:outline-none'

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'request failed'
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setSaved(true)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Change password</h2>
      {error && <div className="mb-3"><Alert variant="error">{error}</Alert></div>}
      {saved && <div className="mb-3"><Alert variant="success">Password changed. Other devices were logged out.</Alert></div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          className={inputClass}
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          required
          aria-label="Current password"
        />
        <input
          className={inputClass}
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password (at least 8 characters)"
          autoComplete="new-password"
          minLength={8}
          required
          aria-label="New password"
        />
        <button type="submit" className="btn-primary px-4 py-2 text-sm">Change password</button>
      </form>
    </div>
  )
}

function BackupCodesPanel({ codes }: { codes: string[] }) {
  return (
    <div className="mt-3">
      <Alert variant="warning">
        Store these backup codes somewhere safe. Each works once and they are not shown again.
      </Alert>
      <div className="grid grid-cols-2 gap-1 mt-2 font-mono text-xs text-text-primary">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
    </div>
  )
}

function TwoFactorSection({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleEnroll() {
    setError(null)
    try {
      setEnrolment(await enrollTwoFactor())
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const result = await confirmTwoFactor(code)
      setBackupCodes(result.backup_codes)
      setEnrolment(null)
      setCode('')
      onChanged()
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await disableTwoFactor(password, code)
      setPassword('')
      setCode('')
      setBackupCodes(null)
      onChanged()
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function handleRegenerate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const result = await regenerateBackupCodes(password, code)
      setBackupCodes(result.backup_codes)
      setPassword('')
      setCode('')
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-1">Two-factor authentication</h2>
      <p className="text-xs text-text-muted mb-3">
        {enabled
          ? 'Enabled. Logging in requires a code from your authenticator app.'
          : 'Add a second step to login using an authenticator app.'}
      </p>
      {error && <div className="mb-3"><Alert variant="error">{error}</Alert></div>}

      {!enabled && !enrolment && (
        <button onClick={handleEnroll} className="btn-primary px-4 py-2 text-sm">
          Enable two-factor
        </button>
      )}

      {!enabled && enrolment && (
        <form onSubmit={handleConfirm} className="space-y-3">
          <div className="bg-white p-3 rounded-[7px] w-fit">
            <QRCodeSVG value={enrolment.otpauth_uri} size={160} />
          </div>
          <p className="text-xs text-text-muted">
            Scan with your authenticator app, or enter the secret manually:{' '}
            <span className="font-mono break-all text-text-primary">{enrolment.secret}</span>
          </p>
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code from the app"
            autoComplete="one-time-code"
            required
            aria-label="Confirmation code"
          />
          <button type="submit" className="btn-primary px-4 py-2 text-sm">Confirm and enable</button>
        </form>
      )}

      {enabled && (
        <form className="space-y-3">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            aria-label="Password"
          />
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Current code or backup code"
            autoComplete="one-time-code"
            aria-label="Two-factor code"
          />
          <div className="flex gap-2">
            <button onClick={handleRegenerate} className="btn-secondary px-4 py-2 text-sm">
              New backup codes
            </button>
            <button onClick={handleDisable} className="btn-secondary px-4 py-2 text-sm">
              Disable two-factor
            </button>
          </div>
        </form>
      )}

      {backupCodes && <BackupCodesPanel codes={backupCodes} />}
    </div>
  )
}

export default function AccountPage() {
  const queryClient = useQueryClient()
  const { data: account } = useQuery({ queryKey: ['auth-me'], queryFn: getMe, retry: false })

  if (!account) return null

  return (
    <div className="max-w-lg mx-auto mt-8 space-y-4">
      <div>
        <h1 className="text-base font-semibold text-text-primary">Account</h1>
        <p className="text-xs text-text-muted">{account.email}</p>
      </div>
      <PasswordSection />
      <TwoFactorSection
        enabled={account.totp_enabled}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['auth-me'] })}
      />
    </div>
  )
}
