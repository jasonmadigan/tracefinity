// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccountMenu } from './AccountMenu'
import type { Account, AuthStatus } from '@/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('@/lib/api', () => ({
  getAuthStatus: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
  navigation: { toLogin: vi.fn(), toHome: vi.fn() },
}))

import { getAuthStatus, getMe, logout, navigation } from '@/lib/api'

const AUTHENTICATED: AuthStatus = { mode: 'native', setup_required: false, authenticated: true }
const ACCOUNT: Account = {
  id: 'a1',
  email: 'admin@example.com',
  is_admin: true,
  disabled: false,
  created_at: 'now',
  totp_enabled: false,
}

beforeEach(() => {
  vi.mocked(getAuthStatus).mockReset().mockResolvedValue(AUTHENTICATED)
  vi.mocked(getMe).mockReset().mockResolvedValue(ACCOUNT)
  vi.mocked(logout).mockReset().mockResolvedValue(undefined)
  vi.mocked(navigation.toLogin).mockReset()
})

afterEach(cleanup)

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AccountMenu />
    </QueryClientProvider>,
  )
}

async function openMenu() {
  renderMenu()
  fireEvent.click(await screen.findByTitle('Account'))
}

describe('AccountMenu logout', () => {
  it('leaves through the navigation seam, not window.location', async () => {
    await openMenu()
    fireEvent.click(await screen.findByText('Log out'))
    await waitFor(() => expect(navigation.toLogin).toHaveBeenCalled())
    expect(logout).toHaveBeenCalled()
  })

  it('still leaves when the token is already gone', async () => {
    vi.mocked(logout).mockRejectedValue(new Error('already revoked'))
    await openMenu()
    fireEvent.click(await screen.findByText('Log out'))
    await waitFor(() => expect(navigation.toLogin).toHaveBeenCalled())
  })
})
