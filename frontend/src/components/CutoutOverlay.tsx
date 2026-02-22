import type { FingerHole } from '@/types'
import { DISPLAY_SCALE } from '@/lib/constants'

interface Props {
  holes: FingerHole[]
  zoom?: number
  interactive?: boolean
  selectedId?: string
  editMode?: string
  onMouseDown?: (id: string, e: React.MouseEvent) => void
  onClick?: (e: React.MouseEvent) => void
}

export function CutoutOverlay({ holes, zoom = 1, interactive, selectedId, editMode, onMouseDown, onClick }: Props) {
  return (
    <>
      {holes.map(fh => {
        const x = fh.x * DISPLAY_SCALE
        const y = fh.y * DISPLAY_SCALE
        const r = fh.radius * DISPLAY_SCALE
        const shape = fh.shape || 'circle'
        const rotation = fh.rotation || 0
        const isSelected = interactive && selectedId === fh.id
        const w = shape === 'rectangle' && fh.width ? fh.width * DISPLAY_SCALE : r * 2
        const h = shape === 'rectangle' && fh.height ? fh.height * DISPLAY_SCALE : r * 2

        const fill = isSelected ? 'rgb(30, 41, 59)' : 'rgb(51, 65, 85)'
        const stroke = isSelected ? 'rgb(90, 180, 222)' : 'rgb(30, 41, 59)'
        const strokeWidth = (isSelected ? 3 : 1) / zoom
        const cursor = interactive && editMode === 'select' ? 'cursor-move' : interactive ? 'cursor-default' : 'pointer-events-none'

        return (
          <g key={fh.id} transform={rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined}>
            {shape === 'circle' && (
              <circle
                cx={x} cy={y} r={r}
                fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                className={cursor}
                onMouseDown={interactive && onMouseDown ? (e) => onMouseDown(fh.id, e) : undefined}
                onClick={interactive && onClick ? onClick : undefined}
              />
            )}
            {(shape === 'square' || shape === 'rectangle') && (
              <rect
                x={x - w / 2} y={y - h / 2} width={w} height={h}
                fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                className={cursor}
                onMouseDown={interactive && onMouseDown ? (e) => onMouseDown(fh.id, e) : undefined}
                onClick={interactive && onClick ? onClick : undefined}
              />
            )}
          </g>
        )
      })}
    </>
  )
}
