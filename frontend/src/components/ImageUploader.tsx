'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

interface Props {
  onUpload: (file: File) => void
  disabled?: boolean
}

export function ImageUploader({ onUpload, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleClick() {
    if (!disabled) {
      inputRef.current?.click()
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && !disabled) {
      onUpload(file)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!disabled) {
      setIsDragging(true)
    }
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
    if (file && file.type.startsWith('image/')) {
      onUpload(file)
    }
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border border-dashed rounded-[5px] py-8 px-6 text-center cursor-pointer
        transition-colors bg-elevated/50
        ${isDragging ? 'border-accent bg-accent-muted' : 'border-border-subtle hover:border-text-muted hover:bg-elevated'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
      <Upload className="w-8 h-8 mx-auto text-text-muted mb-3" />
      {isDragging ? (
        <p className="text-sm text-blue-400">Drop the image here</p>
      ) : (
        <div>
          <p className="text-sm text-text-secondary mb-1">
            Drag and drop an image, or click to select
          </p>
          <p className="text-xs text-text-muted">
            Supports JPG, PNG, WebP, HEIC
          </p>
        </div>
      )}
    </div>
  )
}
