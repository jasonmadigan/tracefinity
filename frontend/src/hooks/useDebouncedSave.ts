import { useState, useEffect, useRef } from 'react'

export function useDebouncedSave(
  saveFn: () => Promise<void> | void,
  deps: unknown[],
  delay: number = 150,
  options?: { skipInitial?: boolean }
): { saving: boolean; saved: boolean } {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveRef = useRef<(() => void) | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)
  const armedRef = useRef(!options?.skipInitial)
  const saveFnRef = useRef(saveFn)
  saveFnRef.current = saveFn

  // arm after initial render cycle
  useEffect(() => {
    if (options?.skipInitial) {
      const t = setTimeout(() => { armedRef.current = true }, 100)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!armedRef.current) return
    const doSave = async () => {
      setSaving(true)
      setSaved(false)
      try {
        await saveFnRef.current()
        setSaved(true)
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
      } catch {
        // ignore
      } finally {
        setSaving(false)
      }
    }
    pendingSaveRef.current = doSave
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      pendingSaveRef.current = null
      doSave()
    }, delay)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // flush pending save on page unload
  useEffect(() => {
    const flush = () => { pendingSaveRef.current?.() }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  return { saving, saved }
}
