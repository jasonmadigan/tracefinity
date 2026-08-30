'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { LogOut, Settings2, User, Users } from 'lucide-react'
import { getAuthStatus, getMe, logout, navigation } from '@/lib/api'
import { IconButton } from '@/components/IconButton'

// presentational only: app-wide setup and login routing lives in AuthGate
export function AccountMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: status } = useQuery({
    queryKey: ['auth-status'],
    queryFn: getAuthStatus,
    staleTime: 30_000,
    retry: false,
  })
  const authenticated = status?.mode === 'native' && status.authenticated
  const { data: account } = useQuery({
    queryKey: ['auth-me'],
    queryFn: getMe,
    enabled: authenticated,
    retry: false,
  })

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // token may already be gone; the login page is the destination either way
    }
    navigation.toLogin()
  }

  if (!authenticated) return null

  return (
    <div ref={ref} className="relative">
      <IconButton onClick={() => setOpen(!open)} title="Account">
        <User className="w-4 h-4" />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 glass rounded-[10px] shadow-xl z-50 p-2">
          <div className="px-2 py-1.5 text-xs text-text-muted truncate border-b border-border mb-1">
            {account?.email ?? '…'}
          </div>
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-primary rounded-[7px] hover:bg-glass-hover"
          >
            <Settings2 className="w-3.5 h-3.5" /> Account settings
          </Link>
          {account?.is_admin && (
            <Link
              href="/admin/users"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-primary rounded-[7px] hover:bg-glass-hover"
            >
              <Users className="w-3.5 h-3.5" /> Manage users
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-text-primary rounded-[7px] hover:bg-glass-hover cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Log out
          </button>
        </div>
      )}
    </div>
  )
}
