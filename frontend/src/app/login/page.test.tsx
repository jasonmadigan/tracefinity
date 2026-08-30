// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoginPage from './page'
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
      setup_required: false,
      authenticated: false,
    }),
    login: vi.fn(),
    loginTwoFactor: vi.fn(),
    navigation: { toLogin: vi.fn(), toHome: vi.fn() },
  }
})

import { login, loginTwoFactor, navigation } from '@/lib/api'

const loginMock = vi.mocked(login)
const loginTwoFactorMock = vi.mocked(loginTwoFactor)
const toHomeMock = vi.mocked(navigation.toHome)

beforeEach(() => {
  loginMock.mockReset()
  loginTwoFactorMock.mockReset()
  toHomeMock.mockReset()
})

afterEach(cleanup)

function submitCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('LoginPage', () => {
  it('logs straight in for accounts without 2FA', async () => {
    loginMock.mockResolvedValue({ pending: false, pending_token: null, account: null })
    render(<LoginPage />)
    submitCredentials('admin@example.com', 'password')
    await waitFor(() => expect(toHomeMock).toHaveBeenCalled())
    expect(loginMock).toHaveBeenCalledWith('admin@example.com', 'password')
  })

  it('shows the error and stays put on bad credentials', async () => {
    loginMock.mockRejectedValue(new ApiError('invalid email or password', 401))
    render(<LoginPage />)
    submitCredentials('admin@example.com', 'wrong')
    expect(await screen.findByText('invalid email or password')).toBeTruthy()
    expect(toHomeMock).not.toHaveBeenCalled()
  })

  it('switches to the code step for 2FA accounts and redeems the pending token', async () => {
    loginMock.mockResolvedValue({ pending: true, pending_token: 'tok-1', account: null })
    loginTwoFactorMock.mockResolvedValue({ pending: false, pending_token: null, account: null })
    render(<LoginPage />)
    submitCredentials('admin@example.com', 'password')

    const codeInput = await screen.findByLabelText('Two-factor code')
    // no credentials are held in the form between steps
    expect(screen.queryByLabelText('Password')).toBeNull()

    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(toHomeMock).toHaveBeenCalled())
    expect(loginTwoFactorMock).toHaveBeenCalledWith('tok-1', '123456')
  })

  it('falls back to the password step when the pending token has expired', async () => {
    loginMock.mockResolvedValue({ pending: true, pending_token: 'tok-1', account: null })
    loginTwoFactorMock.mockRejectedValue(
      new ApiError('invalid or expired login token', 401, 'pending_login_invalid'),
    )
    render(<LoginPage />)
    submitCredentials('admin@example.com', 'password')

    const codeInput = await screen.findByLabelText('Two-factor code')
    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByLabelText('Password')).toBeTruthy()
  })

  it('stays on the code step when only the code was wrong', async () => {
    loginMock.mockResolvedValue({ pending: true, pending_token: 'tok-1', account: null })
    loginTwoFactorMock.mockRejectedValue(
      new ApiError('invalid code', 401, 'two_factor_code_invalid'),
    )
    render(<LoginPage />)
    submitCredentials('admin@example.com', 'password')

    const codeInput = await screen.findByLabelText('Two-factor code')
    fireEvent.change(codeInput, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('invalid code')).toBeTruthy()
    expect(screen.getByLabelText('Two-factor code')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('does not restart the login on a message that merely mentions a token', async () => {
    loginMock.mockResolvedValue({ pending: true, pending_token: 'tok-1', account: null })
    loginTwoFactorMock.mockRejectedValue(
      new ApiError('your login token app is misconfigured', 401, 'two_factor_code_invalid'),
    )
    render(<LoginPage />)
    submitCredentials('admin@example.com', 'password')

    const codeInput = await screen.findByLabelText('Two-factor code')
    fireEvent.change(codeInput, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('your login token app is misconfigured')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })
})
