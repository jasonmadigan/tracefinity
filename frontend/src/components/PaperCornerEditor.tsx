'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Point } from '@/types'

interface Props {
  imageUrl: string
  corners: Point[]
  onCornersChange: (corners: Point[]) => void
}

const HANDLE_RADIUS = 12
const HANDLE_HIT_RADIUS = 24

export function PaperCornerEditor({ imageUrl, corners, onCornersChange }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [fitted, setFitted] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageSize({ width: img.width, height: img.height })

      if (corners.length === 0) {
        const margin = Math.min(img.width, img.height) * 0.1
        onCornersChange([
          { x: margin, y: margin },
          { x: img.width - margin, y: margin },
          { x: img.width - margin, y: img.height - margin },
          { x: margin, y: img.height - margin },
        ])
      }
    }
    img.src = imageUrl
    return () => { cancelled = true }
  }, [imageUrl])

  // fit container to available space while preserving aspect ratio
  useEffect(() => {
    function updateSize() {
      if (!wrapperRef.current || !imageSize.width || !imageSize.height) return
      const availW = wrapperRef.current.clientWidth
      const availH = wrapperRef.current.clientHeight
      const imgAspect = imageSize.width / imageSize.height
      let w = availW
      let h = w / imgAspect
      if (h > availH) {
        h = availH
        w = h * imgAspect
      }
      setFitted({ width: Math.floor(w), height: Math.floor(h) })
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [imageSize])

  const displayScale = imageSize.width > 0 && fitted.width > 0 ? fitted.width / imageSize.width : 1

  const getScaledPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 }

      const rect = containerRef.current.getBoundingClientRect()
      const scaleX = imageSize.width / rect.width
      const scaleY = imageSize.height / rect.height

      return {
        x: Math.max(0, Math.min(imageSize.width, (clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(imageSize.height, (clientY - rect.top) * scaleY)),
      }
    },
    [imageSize]
  )

  const handleMouseDown = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(index)
  }

  const handleTouchStart = (index: number) => (e: React.TouchEvent) => {
    e.preventDefault()
    setDragging(index)
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragging === null) return
      const point = getScaledPoint(e.clientX, e.clientY)
      const updated = [...corners]
      updated[dragging] = point
      onCornersChange(updated)
    },
    [dragging, corners, getScaledPoint, onCornersChange]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (dragging === null) return
      e.preventDefault()
      const t = e.touches[0]
      const point = getScaledPoint(t.clientX, t.clientY)
      const updated = [...corners]
      updated[dragging] = point
      onCornersChange(updated)
    },
    [dragging, corners, getScaledPoint, onCornersChange]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  const handleTouchEnd = useCallback(() => {
    setDragging(null)
  }, [])

  useEffect(() => {
    if (dragging !== null) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleTouchMove, { passive: false })
      window.addEventListener('touchend', handleTouchEnd)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd])

  if (!imageSize.width || !fitted.width) {
    return (
      <div ref={wrapperRef} className="w-full h-full">
        <div className="bg-inset rounded-lg aspect-[4/3]" />
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="w-full h-full flex items-center justify-center">
      <div
        ref={containerRef}
        className="relative bg-inset rounded-lg overflow-hidden"
        style={{ width: fitted.width, height: fitted.height }}
      >
        <img
          src={imageUrl}
          alt="Uploaded"
          className="w-full h-full"
          draggable={false}
        />

        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {corners.length === 4 && (
            <polygon
              points={corners
                .map((c) => `${c.x * displayScale},${c.y * displayScale}`)
                .join(' ')}
              fill="rgba(59, 130, 246, 0.1)"
              stroke="rgb(59, 130, 246)"
              strokeWidth={2}
            />
          )}

          {corners.map((corner, index) => (
            <g key={index}>
              <circle
                cx={corner.x * displayScale}
                cy={corner.y * displayScale}
                r={HANDLE_HIT_RADIUS}
                fill="transparent"
                className="pointer-events-auto cursor-move touch-none"
                onMouseDown={handleMouseDown(index)}
                onTouchStart={handleTouchStart(index)}
              />
              <circle
                cx={corner.x * displayScale}
                cy={corner.y * displayScale}
                r={HANDLE_RADIUS}
                fill="#1e293b"
                stroke="rgb(59, 130, 246)"
                strokeWidth={2}
                className="pointer-events-none"
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
