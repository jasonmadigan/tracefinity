// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PhotoWarningsBanner, PHOTO_GUIDE_URL } from './PhotoWarningsBanner'

// jsdom has no matchMedia; useTheme needs it during init
window.matchMedia = vi.fn().mockReturnValue({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}) as unknown as typeof window.matchMedia

const warnings = [
  { code: 'camera_too_close', message: 'Camera looks about 25 cm from the paper.' },
  { code: 'paper_out_of_frame', message: 'The paper looks cut off at the photo edge.' },
]

describe('PhotoWarningsBanner', () => {
  afterEach(cleanup)

  it('renders every warning message', () => {
    render(<PhotoWarningsBanner warnings={warnings} onDismiss={() => {}} />)

    expect(screen.getByText(/25 cm from the paper/)).toBeTruthy()
    expect(screen.getByText(/cut off at the photo edge/)).toBeTruthy()
  })

  it('links to the photo guide', () => {
    render(<PhotoWarningsBanner warnings={warnings} onDismiss={() => {}} />)

    const link = screen.getByRole('link', { name: /photo guide/i })
    expect(link.getAttribute('href')).toBe(PHOTO_GUIDE_URL)
  })

  it('calls onDismiss when dismissed', () => {
    const onDismiss = vi.fn()
    render(<PhotoWarningsBanner warnings={warnings} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('renders nothing without warnings', () => {
    const { container } = render(<PhotoWarningsBanner warnings={[]} onDismiss={() => {}} />)

    expect(container.innerHTML).toBe('')
  })
})
