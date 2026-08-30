'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getAuthStatus } from '@/lib/api'

const AUTH_PAGES = ['/login', '/setup']

/**
 * First-run and login routing for the whole app.
 *
 * This belongs in the layout, not in a header control: moving or removing a
 * piece of chrome must not be able to drop first-run gating.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const { data: status } = useQuery({
    queryKey: ['auth-status'],
    queryFn: getAuthStatus,
    staleTime: 30_000,
    retry: false,
  })

  // route to first-run setup or login before anything else renders data
  useEffect(() => {
    if (!status || status.mode !== 'native') return
    if (status.setup_required) {
      if (pathname !== '/setup') router.replace('/setup')
      return
    }
    if (pathname === '/setup') {
      router.replace(status.authenticated ? '/' : '/login')
      return
    }
    if (!status.authenticated && !AUTH_PAGES.includes(pathname)) {
      router.replace('/login')
    }
  }, [status, pathname, router])

  return <>{children}</>
}
