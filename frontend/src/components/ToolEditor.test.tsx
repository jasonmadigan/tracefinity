// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToolEditor } from './ToolEditor'

const points = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
]

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  })
})

function renderEditor(outputSmoothed = true) {
  const onSmoothedChange = vi.fn()
  const result = render(
    <ToolEditor
      points={points}
      fingerHoles={[]}
      smoothed={outputSmoothed}
      smoothLevel={0.5}
      onPointsChange={() => {}}
      onFingerHolesChange={() => {}}
      onSmoothedChange={onSmoothedChange}
      onSmoothLevelChange={() => {}}
    />
  )
  return { ...result, onSmoothedChange }
}

describe('ToolEditor outline view', () => {
  afterEach(cleanup)

  it('opens in the accurate editable view without changing the smooth output preference', () => {
    const { container, onSmoothedChange } = renderEditor(true)

    expect(screen.getByRole('button', { name: 'Accurate' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Output: Smooth' }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('circle.cursor-move')).toHaveLength(points.length)
    expect(onSmoothedChange).not.toHaveBeenCalled()
  })

  it('previews smoothing independently from the saved output preference', () => {
    const { container, onSmoothedChange } = renderEditor(false)

    fireEvent.click(screen.getByRole('button', { name: 'Smooth' }))

    expect(screen.getByRole('button', { name: 'Smooth' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Output: Accurate' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelectorAll('circle.cursor-move')).toHaveLength(0)
    expect(onSmoothedChange).not.toHaveBeenCalled()
  })

  it('changes the saved output preference only through the output control', () => {
    const { onSmoothedChange } = renderEditor(true)

    fireEvent.click(screen.getByRole('button', { name: 'Output: Smooth' }))

    expect(onSmoothedChange).toHaveBeenCalledWith(false)
  })
})
