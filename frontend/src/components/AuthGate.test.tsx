// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGate } from './AuthGate'
import { AccountMenu } from './AccountMenu'
import type { AuthStatus } from '@/types'

const replaceMock = vi.fn()
let pathname = '/'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathname,
}))

vi.mock('@/lib/api', () => ({
  getAuthStatus: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
  navigation: { toLogin: vi.fn(), toHome: vi.fn() },
}))

import { getAuthStatus, getMe, logout, navigation } from '@/lib/api'

const statusMock = vi.mocked(getAuthStatus)

beforeEach(() => {
  replaceMock.mockReset()
  statusMock.mockReset()
  vi.mocked(getMe).mockReset()
  vi.mocked(logout).mockReset()
  vi.mocked(navigation.toLogin).mockReset()
  pathname = '/'
})

afterEach(cleanup)

function renderGate(status: AuthStatus, at = '/') {
  pathname = at
  statusMock.mockResolvedValue(status)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <div>app content</div>
      </AuthGate>
    </QueryClientProvider>,
  )
}

const NATIVE_UNSET: AuthStatus = { mode: 'native', setup_required: true, authenticated: false }
const NATIVE_OUT: AuthStatus = { mode: 'native', setup_required: false, authenticated: false }
const NATIVE_IN: AuthStatus = { mode: 'native', setup_required: false, authenticated: true }

describe('AuthGate', () => {
  it('sends a fresh instance to first-run setup', async () => {
    renderGate(NATIVE_UNSET, '/tools/t1')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/setup'))
  })

  it('leaves an unconfigured instance alone once it is on /setup', async () => {
    renderGate(NATIVE_UNSET, '/setup')
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('sends a logged-out visitor to login', async () => {
    renderGate(NATIVE_OUT, '/bins/b1')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
  })

  it('moves off /setup once setup is done', async () => {
    renderGate(NATIVE_OUT, '/setup')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
  })

  it('sends an authenticated visitor off /setup to the app', async () => {
    renderGate(NATIVE_IN, '/setup')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
  })

  it('leaves an authenticated visitor where they are', async () => {
    renderGate(NATIVE_IN, '/tools/t1')
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it.each(['open', 'proxy'])('does not route in %s mode', async (mode) => {
    renderGate({ mode, setup_required: false, authenticated: false } as AuthStatus, '/tools/t1')
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('renders its children', async () => {
    renderGate(NATIVE_IN)
    expect(await screen.findByText('app content')).toBeTruthy()
  })
})

describe('AccountMenu no longer carries the gating', () => {
  it('does not route a fresh instance to setup on its own', async () => {
    statusMock.mockResolvedValue(NATIVE_UNSET)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AccountMenu />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
