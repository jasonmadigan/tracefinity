'use client'

import { useRef, useState } from 'react'
import { Camera, Upload } from 'lucide-react'
import { useReducedMotion } from '@/hooks/useReducedMotion'

function UploadIllustration({ reduceMotion }: { reduceMotion: boolean }) {
  const anim = reduceMotion ? '' : 'upload-anim'

  return (
    <svg viewBox="0 0 280 180" fill="none" className="w-full h-full" style={{ color: 'var(--color-surface)' }}>
      <defs>
        <filter id="paperShadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="2" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.35" />
        </filter>
        <filter id="toolShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.4" />
        </filter>
        <linearGradient id="scanGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5ab4de" stopOpacity="0" />
          <stop offset="40%" stopColor="#5ab4de" stopOpacity="0.12" />
          <stop offset="60%" stopColor="#5ab4de" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#5ab4de" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="280" height="180" rx="6" fill="currentColor" />

      {/* paper sheet */}
      <g transform="rotate(-2, 115, 92)" filter="url(#paperShadow)">
        <rect x="30" y="22" width="170" height="130" rx="2" fill="#e2e8f0" />
        <rect x="30" y="22" width="170" height="130" rx="2" fill="#f1f5f9" opacity="0.4" />
        {[42, 58, 74, 90, 106, 122, 138].map(y => (
          <line key={y} x1="40" y1={y} x2="190" y2={y} stroke="#cbd5e1" strokeWidth="0.3" opacity="0.6" />
        ))}
        <line x1="52" y1="24" x2="52" y2="150" stroke="#e8b4b8" strokeWidth="0.3" opacity="0.4" />
      </g>

      {/* screwdriver */}
      <g
        filter="url(#toolShadow)"
        className={anim}
        style={!reduceMotion ? { animation: 'upload-tool-1 0.4s ease both' } : undefined}
      >
        <g transform="rotate(15, 80, 70)">
          <rect x="74" y="80" width="12" height="50" rx="4" fill="#dc6843" />
          <rect x="76" y="82" width="8" height="46" rx="3" fill="#e07850" />
          {[90, 96, 102, 108, 114].map(y => (
            <line key={y} x1="75" y1={y} x2="85" y2={y} stroke="#c45a38" strokeWidth="0.6" />
          ))}
          <rect x="76" y="74" width="8" height="8" rx="1" fill="#94a3b8" />
          <rect x="78.5" y="12" width="3" height="64" rx="1" fill="#94a3b8" />
          <line x1="80" y1="14" x2="80" y2="74" stroke="#b0bec5" strokeWidth="0.5" />
        </g>
      </g>

      {/* spanner */}
      <g
        filter="url(#toolShadow)"
        className={anim}
        style={!reduceMotion ? { animation: 'upload-tool-2 0.8s ease both' } : undefined}
      >
        <g transform="rotate(-25, 160, 90)">
          <path d="M155 16 L153 28 L147 32 L147 38 L153 42 L155 54 L165 54 L167 42 L173 38 L173 32 L167 28 L165 16Z" fill="#64748b" />
          <path d="M155 16 L153 28 L147 32 L147 38 L153 42 L155 54 L160 54 L160 16Z" fill="#6b7d91" />
          <rect x="155" y="52" width="10" height="100" rx="1" fill="#64748b" />
          <rect x="155" y="52" width="5" height="100" rx="1" fill="#6b7d91" />
          <ellipse cx="160" cy="155" rx="12" ry="12" fill="#64748b" />
          <ellipse cx="160" cy="155" rx="12" ry="12" fill="#6b7d91" clipPath="inset(0 50% 0 0)" />
          <ellipse cx="160" cy="155" rx="6" ry="6" fill="currentColor" />
        </g>
      </g>

      {/* hex key */}
      <g
        filter="url(#toolShadow)"
        className={anim}
        style={!reduceMotion ? { animation: 'upload-tool-3 1.2s ease both' } : undefined}
      >
        <g transform="rotate(40, 120, 115)">
          <path d="M118 80 L118 125 L140 125" stroke="#94a3b8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M118 80 L118 125 L140 125" stroke="#b0bec5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      </g>

      {/* scan line */}
      {!reduceMotion && (
        <g transform="rotate(-2, 115, 92)">
          <rect
            x="30" y="22" width="170" height="18" fill="url(#scanGlow)"
            className={anim}
            style={{ animation: 'upload-scan 3.5s ease-in-out infinite' }}
          />
        </g>
      )}

      {/* corner brackets */}
      {[
        { x: 28, y: 20, d: 'M28 32 L28 20 L40 20' },
        { x: 200, y: 16, d: 'M188 16 L200 16 L200 28' },
        { x: 203, y: 152, d: 'M203 140 L203 152 L191 152' },
        { x: 33, y: 156, d: 'M45 156 L33 156 L33 144' },
      ].map(({ x, y, d }, i) => (
        <g key={i}>
          {!reduceMotion && (
            <circle
              cx={x} cy={y} r="4" fill="none" stroke="#5ab4de" strokeWidth="1"
              className={anim}
              style={{
                transformOrigin: `${x}px ${y}px`,
                animation: `upload-pulse 2s ${i * 0.5}s ease-out infinite`,
              }}
            />
          )}
          <path d={d} stroke="#5ab4de" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.8" />
          <circle cx={x} cy={y} r="2" fill="#5ab4de" />
        </g>
      ))}

      {/* phone */}
      <g
        className={anim}
        style={!reduceMotion ? { animation: 'upload-phone-bob 4s ease-in-out infinite' } : undefined}
      >
        <rect x="228" y="28" width="34" height="56" rx="5" fill="#1e293b" stroke="#334155" strokeWidth="1" />
        <rect x="232" y="34" width="26" height="40" rx="2" fill="#0f172a" />
        <circle cx="245" cy="54" r="9" fill="none" stroke="#334155" strokeWidth="1" />
        <circle
          cx="245" cy="54" r="6" fill="#5ab4de"
          className={anim}
          style={!reduceMotion
            ? { animation: 'upload-lens-glow 2s ease-in-out infinite' }
            : { opacity: 0.15 }
          }
        />
        <circle cx="245" cy="54" r="3.5" fill="#5ab4de" opacity="0.35" />
        <circle cx="245" cy="54" r="1.5" fill="#5ab4de" opacity="0.8" />
        <circle cx="245" cy="78" r="2.5" fill="none" stroke="#334155" strokeWidth="0.8" />
      </g>

      {/* dashed line from phone to scene */}
      <path
        d="M245 90 L245 92 Q245 102 238 108 L180 138"
        stroke="#5ab4de" strokeWidth="1" strokeDasharray="3 3" opacity="0.3"
        className={anim}
        style={!reduceMotion ? { animation: 'upload-dash-march 1.5s linear infinite' } : undefined}
      />
      <circle cx="178" cy="139" r="2" fill="#5ab4de" opacity="0.3" />
    </svg>
  )
}

interface Props {
  onUpload: (file: File) => void
  onCaptureRequest?: () => void
  disabled?: boolean
}

export function ImageUploader({ onUpload, onCaptureRequest, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const reduceMotion = useReducedMotion()

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.closest('button,input')) return
    if (!disabled) fileInputRef.current?.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && !disabled) onUpload(file)
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!disabled) setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) onUpload(file)
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        glass rounded-[10px] py-6 px-6 cursor-pointer
        transition-all duration-150
        ${isDragging ? 'border-accent bg-accent-muted scale-[1.005]' : 'hover:bg-glass-hover'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onClick={(e) => e.stopPropagation()}
        onChange={handleChange}
        className="hidden"
      />
      {isDragging ? (
        <div className="py-4 text-center">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-accent-muted flex items-center justify-center">
            <Upload className="w-4 h-4 text-accent" />
          </div>
          <p className="text-sm text-accent font-medium">Drop the image here</p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
          <div className="w-72 h-44 flex-shrink-0">
            <UploadIllustration reduceMotion={reduceMotion} />
          </div>
          <div className="text-center sm:text-left flex-1">
            <p className="text-lg text-white font-bold mb-3 leading-snug">
              Photograph your tools on a sheet of paper
            </p>
            <ul className="text-sm text-text-secondary leading-relaxed space-y-1.5 mb-5">
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                Place tools on A4, Letter, A3, or Tabloid paper
              </li>
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                Tools can overflow the paper edges
              </li>
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                All four paper corners must be visible
              </li>
              <li className="flex items-start gap-2 justify-center sm:justify-start">
                <span className="mt-[7px] block w-1.5 h-1.5 rounded-full bg-accent/50 flex-shrink-0" />
                Take a top-down photo
              </li>
            </ul>
            <div className="flex flex-col sm:flex-row gap-2 justify-center sm:justify-start">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCaptureRequest?.()
                }}
                disabled={disabled || !onCaptureRequest}
                className="min-h-11 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold shadow-lg shadow-accent/20 cursor-pointer disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
                Take photo
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled) fileInputRef.current?.click()
                }}
                className="min-h-11 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-elevated border border-border-subtle text-text-primary text-sm font-semibold hover:bg-glass-hover transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Upload file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
