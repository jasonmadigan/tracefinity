'use client'

import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert } from '@/components/Alert'
import {
  ApiError,
  clearUserTwoFactor,
  createUser,
  disableUser,
  enableUser,
  getMe,
  listUsers,
  resetUserPassword,
} from '@/lib/api'
import type { Account } from '@/types'

const inputClass =
  'w-full px-3 py-2 text-sm rounded-[7px] bg-surface border border-border text-text-primary focus:outline-none'

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'request failed'
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await createUser({ email, password, is_admin: isAdmin })
      setEmail('')
      setPassword('')
      setIsAdmin(false)
      onCreated()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Create account</h2>
      {error && <div className="mb-3"><Alert variant="error">{error}</Alert></div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          className={inputClass}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          aria-label="Email"
        />
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (at least 8 characters)"
          minLength={8}
          required
          aria-label="Password"
        />
        <label className="flex items-center gap-2 text-xs text-text-primary">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />
          Administrator
        </label>
        <button type="submit" className="btn-primary px-4 py-2 text-sm">Create</button>
      </form>
    </div>
  )
}

function UserRow({ user, me, onChanged, onError }: {
  user: Account
  me: Account
  onChanged: () => void
  onError: (message: string) => void
}) {
  const [resetting, setResetting] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const isSelf = user.id === me.id

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      onChanged()
    } catch (err) {
      onError(errorText(err))
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    await run(() => resetUserPassword(user.id, newPassword))
    setResetting(false)
    setNewPassword('')
  }

  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-text-primary truncate">
            {user.email}
            {user.is_admin && <span className="ml-2 text-[10px] uppercase text-text-muted">admin</span>}
            {user.disabled && <span className="ml-2 text-[10px] uppercase text-red-400">disabled</span>}
            {isSelf && <span className="ml-2 text-[10px] uppercase text-text-muted">you</span>}
          </div>
          <div className="text-[10px] text-text-muted font-mono truncate">{user.id}</div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {!isSelf && (user.disabled ? (
            <button onClick={() => run(() => enableUser(user.id))} className="btn-secondary px-2.5 py-1 text-xs">
              Enable
            </button>
          ) : (
            <button onClick={() => run(() => disableUser(user.id))} className="btn-secondary px-2.5 py-1 text-xs">
              Disable
            </button>
          ))}
          <button onClick={() => setResetting(!resetting)} className="btn-secondary px-2.5 py-1 text-xs">
            Reset password
          </button>
          {user.totp_enabled && (
            <button onClick={() => run(() => clearUserTwoFactor(user.id))} className="btn-secondary px-2.5 py-1 text-xs">
              Clear 2FA
            </button>
          )}
        </div>
      </div>
      {resetting && (
        <form onSubmit={handleReset} className="flex gap-2 mt-2">
          <input
            className={inputClass}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (at least 8 characters)"
            minLength={8}
            required
            aria-label={`New password for ${user.email}`}
          />
          <button type="submit" className="btn-primary px-3 py-1.5 text-xs flex-shrink-0">Set</button>
        </form>
      )}
    </div>
  )
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data: me } = useQuery({ queryKey: ['auth-me'], queryFn: getMe, retry: false })
  const { data, error: listError } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listUsers,
    enabled: !!me,
    retry: false,
  })

  if (!me) return null
  if (listError instanceof ApiError && listError.status === 403) {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <Alert variant="warning">Administrator access is required to manage users.</Alert>
      </div>
    )
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] })

  return (
    <div className="max-w-lg mx-auto mt-8 space-y-4">
      <h1 className="text-base font-semibold text-text-primary">Users</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="glass-card p-5">
        {(data?.users ?? []).map((user) => (
          <UserRow
            key={user.id}
            user={user}
            me={me}
            onChanged={() => { setError(null); refresh() }}
            onError={setError}
          />
        ))}
      </div>
      <CreateUserForm onCreated={refresh} />
    </div>
  )
}
