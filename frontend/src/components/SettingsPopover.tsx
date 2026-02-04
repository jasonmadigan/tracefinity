'use client'

import { useState, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { getSettings, saveSettings } from '@/lib/settings'

export function SettingsPopover() {
  const [open, setOpen] = useState(false)
  const [bedSize, setBedSize] = useState(256)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setBedSize(getSettings().bedSize)
  }, [])

  // close on outside click
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

  function handleBedSizeChange(v: number) {
    setBedSize(v)
    saveSettings({ bedSize: v })
  }

  const pct = ((bedSize - 150) / (400 - 150)) * 100

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors"
        title="Settings"
      >
        <Settings className="w-4.5 h-4.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-surface border border-border rounded-lg shadow-xl z-50 p-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Settings</h3>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#ebecec] tracking-[0.3px]">Default Bed Size</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={150}
                max={400}
                step={1}
                value={bedSize}
                onChange={(e) => handleBedSizeChange(parseInt(e.target.value))}
                className="flex-1 min-w-0"
                style={{ '--slider-pct': `${pct}%` } as React.CSSProperties}
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={150}
                  max={400}
                  step={1}
                  value={bedSize}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v)) handleBedSizeChange(Math.min(400, Math.max(150, v)))
                  }}
                  className="w-14 h-7 bg-[#222a35] text-right text-xs font-semibold text-[#ebecec] rounded-[5px] pr-2 focus:outline-none"
                />
                <span className="text-[10px] text-text-muted w-5">mm</span>
              </div>
            </div>
            <p className="text-[11px] text-text-muted leading-tight mt-1">
              Bins wider than this are automatically split into printable pieces.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
