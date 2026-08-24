'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { CaptureCrop } from '@/types'

type DragMode = 'move' | 'nw' | 'ne' | 'se' | 'sw'
const MIN_CAPTURE_AREA_SIZE = 0.08

interface Props {
  area: CaptureCrop
  editing: boolean
  containerRef: RefObject<HTMLElement | null>
  onChange: (area: CaptureCrop) => void
}

function clampArea(nextArea: CaptureCrop): CaptureCrop {
  const width = Math.max(MIN_CAPTURE_AREA_SIZE, Math.min(1, nextArea.width))
  const height = Math.max(MIN_CAPTURE_AREA_SIZE, Math.min(1, nextArea.height))
  return {
    x: Math.max(0, Math.min(1 - width, nextArea.x)),
    y: Math.max(0, Math.min(1 - height, nextArea.y)),
    width,
    height,
  }
}

export function CaptureAreaOverlay({ area, editing, containerRef, onChange }: Props) {
  const dragRef = useRef<{
    mode: DragMode
    startX: number
    startY: number
    startCrop: CaptureCrop
  } | null>(null)

  const pointerToUnit = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }, [containerRef])

  function startDrag(mode: DragMode) {
    return (event: ReactPointerEvent) => {
      if (!editing) return
      const point = pointerToUnit(event.clientX, event.clientY)
      if (!point) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = { mode, startX: point.x, startY: point.y, startCrop: area }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
  }

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const point = pointerToUnit(event.clientX, event.clientY)
      if (!point) return

      const dx = point.x - drag.startX
      const dy = point.y - drag.startY
      const start = drag.startCrop
      let next = { ...start }

      if (drag.mode === 'move') {
        next.x = start.x + dx
        next.y = start.y + dy
      } else {
        const left = drag.mode === 'nw' || drag.mode === 'sw'
          ? Math.min(start.x + start.width - MIN_CAPTURE_AREA_SIZE, start.x + dx)
          : start.x
        const right = drag.mode === 'ne' || drag.mode === 'se'
          ? Math.max(start.x + MIN_CAPTURE_AREA_SIZE, start.x + start.width + dx)
          : start.x + start.width
        const top = drag.mode === 'nw' || drag.mode === 'ne'
          ? Math.min(start.y + start.height - MIN_CAPTURE_AREA_SIZE, start.y + dy)
          : start.y
        const bottom = drag.mode === 'sw' || drag.mode === 'se'
          ? Math.max(start.y + MIN_CAPTURE_AREA_SIZE, start.y + start.height + dy)
          : start.y + start.height

        next = {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        }
      }

      onChange(clampArea(next))
    }

    function stopDrag() {
      dragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
    }
  }, [onChange, pointerToUnit])

  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        className="absolute bg-black/35"
        style={{ left: 0, top: 0, width: '100%', height: `${area.y * 100}%` }}
      />
      <div
        className="absolute bg-black/35"
        style={{ left: 0, top: `${(area.y + area.height) * 100}%`, width: '100%', bottom: 0 }}
      />
      <div
        className="absolute bg-black/35"
        style={{ left: 0, top: `${area.y * 100}%`, width: `${area.x * 100}%`, height: `${area.height * 100}%` }}
      />
      <div
        className="absolute bg-black/35"
        style={{ left: `${(area.x + area.width) * 100}%`, top: `${area.y * 100}%`, right: 0, height: `${area.height * 100}%` }}
      />
      <div
        onPointerDown={startDrag('move')}
        className={`absolute border-2 border-accent ${editing ? 'pointer-events-auto cursor-move touch-none' : ''}`}
        style={{
          left: `${area.x * 100}%`,
          top: `${area.y * 100}%`,
          width: `${area.width * 100}%`,
          height: `${area.height * 100}%`,
        }}
      >
        {editing && ([
          ['nw', 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'],
          ['ne', 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'],
          ['se', 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'],
          ['sw', 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'],
        ] as const).map(([mode, className]) => (
          <button
            key={mode}
            type="button"
            aria-label={`Resize capture area ${mode}`}
            onPointerDown={startDrag(mode)}
            className={`absolute w-5 h-5 rounded-full bg-surface border-2 border-accent pointer-events-auto touch-none ${className}`}
          />
        ))}
      </div>
    </div>
  )
}
