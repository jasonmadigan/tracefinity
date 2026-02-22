import { useState, useCallback, useEffect, useRef } from 'react'
import { MAX_HISTORY } from '@/lib/constants'

export function useHistory<T>(
  initial: T,
  onChange: (value: T) => void,
  maxEntries: number = MAX_HISTORY
): {
  set: (value: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
} {
  const [entries, setEntries] = useState<T[]>(() => [JSON.parse(JSON.stringify(initial))])
  const [index, setIndex] = useState(0)
  const isUndoRedoRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const canUndo = index > 0
  const canRedo = index < entries.length - 1

  const set = useCallback((value: T) => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false
      return
    }
    setEntries(prev => {
      const next = prev.slice(0, index + 1)
      next.push(JSON.parse(JSON.stringify(value)))
      if (next.length > maxEntries) next.shift()
      return next
    })
    setIndex(prev => Math.min(prev + 1, maxEntries - 1))
  }, [index, maxEntries])

  const undo = useCallback(() => {
    if (!canUndo) return
    isUndoRedoRef.current = true
    const newIdx = index - 1
    setIndex(newIdx)
    onChangeRef.current(JSON.parse(JSON.stringify(entries[newIdx])))
  }, [canUndo, index, entries])

  const redo = useCallback(() => {
    if (!canRedo) return
    isUndoRedoRef.current = true
    const newIdx = index + 1
    setIndex(newIdx)
    onChangeRef.current(JSON.parse(JSON.stringify(entries[newIdx])))
  }, [canRedo, index, entries])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  return { set, undo, redo, canUndo, canRedo }
}
