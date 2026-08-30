// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SetupPage from './page'
import { ApiError } from '@/lib/api'

// jsdom has no matchMedia; useTheme (via Alert) needs it during init
window.matchMedia = vi.fn().mockReturnValue({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}) as unknown as typeof window.matchMedia

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ApiError: actual.ApiError,
    getAuthStatus: vi.fn().mockResolvedValue({
      mode: 'native',
      setup_required: true,
      authenticated: false,
    }),
    setupAdmin: vi.fn(),
    navigation: { toLogin: vi.fn(), toHome: vi.fn() },
  }
})

import { navigation, setupAdmin } from '@/lib/api'

const setupAdminMock = vi.mocked(setupAdmin)
const toHomeMock = vi.mocked(navigation.toHome)

beforeEach(() => {
  setupAdminMock.mockReset()
  toHomeMock.mockReset()
})

afterEach(cleanup)

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('SetupPage', () => {
  it('creates the first administrator and lands on the app', async () => {
    setupAdminMock.mockResolvedValue({
      id: 'a1', email: 'admin@example.com', is_admin: true, disabled: false,
      created_at: 'now', totp_enabled: false,
    })
    render(<SetupPage />)
    fill('Email', 'admin@example.com')
    fill('Password', 'long password')
    fill('Confirm password', 'long password')
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }))
    await waitFor(() => expect(toHomeMock).toHaveBeenCalled())
    expect(setupAdminMock).toHaveBeenCalledWith('admin@example.com', 'long password')
  })

  it('refuses mismatched passwords without calling the API', async () => {
    render(<SetupPage />)
    fill('Email', 'admin@example.com')
    fill('Password', 'long password')
    fill('Confirm password', 'different password')
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }))
    expect(await screen.findByText('passwords do not match')).toBeTruthy()
    expect(setupAdminMock).not.toHaveBeenCalled()
  })

  it('shows the race-loser 409 from the backend', async () => {
    setupAdminMock.mockRejectedValue(new ApiError('setup has already been completed', 409))
    render(<SetupPage />)
    fill('Email', 'admin@example.com')
    fill('Password', 'long password')
    fill('Confirm password', 'long password')
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }))
    expect(await screen.findByText('setup has already been completed')).toBeTruthy()
  })
})
