import { useMemo, useState } from 'react'

// keeps the selection a subset of the polygons on screen. a re-trace mints
// fresh ids, so a stale selection counts tools that no longer exist. derived
// rather than pruned in an effect so the count is right on the same render.
export function usePolygonSelection(
  polygons: readonly { id: string }[],
): [Set<string>, (next: Set<string>) => void] {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const live = useMemo(() => {
    const present = new Set(polygons.map(p => p.id))
    let stale = false
    for (const id of selected) {
      if (!present.has(id)) {
        stale = true
        break
      }
    }
    // keep the same instance while every id still resolves, so consumers
    // holding the set in an effect dependency do not re-run needlessly
    if (!stale) return selected
    return new Set([...selected].filter(id => present.has(id)))
  }, [polygons, selected])

  return [live, setSelected]
}
