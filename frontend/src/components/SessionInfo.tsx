'use client'

import { useState } from 'react'
import { Pencil, X, Check, Tag } from 'lucide-react'
import type { Session } from '@/types'

interface Props {
  session: Session
  onUpdate: (updates: { name?: string; description?: string; tags?: string[] }) => void
}

export function SessionInfo({ session, onUpdate }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(session.name || '')
  const [description, setDescription] = useState(session.description || '')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(session.tags || [])

  const handleSave = () => {
    onUpdate({
      name: name || undefined,
      description: description || undefined,
      tags,
    })
    setEditing(false)
  }

  const handleCancel = () => {
    setName(session.name || '')
    setDescription(session.description || '')
    setTags(session.tags || [])
    setEditing(false)
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
    }
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
  }

  if (!editing) {
    return (
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="font-medium text-text-primary truncate text-sm">
              {session.name || 'Untitled'}
            </h2>
            {session.tags && session.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {session.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 text-xs bg-elevated text-text-muted rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="p-1 text-text-muted hover:text-text-secondary rounded"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-b border-border space-y-3">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Wrench set"
          className="w-full px-3 py-1.5 text-sm border border-border-subtle rounded bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional notes..."
          rows={2}
          className="w-full px-3 py-1.5 text-sm border border-border-subtle rounded bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          Tags
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add tag..."
            className="flex-1 px-3 py-1.5 text-sm border border-border-subtle rounded bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addTag}
            disabled={!tagInput.trim()}
            className="px-3 py-1.5 text-sm bg-elevated text-text-secondary rounded hover:bg-border-subtle disabled:opacity-50"
          >
            <Tag className="w-4 h-4" />
          </button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs bg-elevated text-text-secondary rounded flex items-center gap-1"
              >
                {tag}
                <button onClick={() => removeTag(tag)} className="hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          className="flex-1 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent-hover flex items-center justify-center gap-1"
        >
          <Check className="w-4 h-4" />
          Save
        </button>
        <button
          onClick={handleCancel}
          className="flex-1 py-1.5 text-sm bg-elevated text-text-secondary rounded hover:bg-border-subtle flex items-center justify-center gap-1"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </div>
  )
}
