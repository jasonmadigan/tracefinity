'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Bounds, GizmoHelper, GizmoViewport, OrbitControls, useBounds } from '@react-three/drei'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ArrowRight, ArrowUp, Box, CircleDot, RotateCcw, Triangle } from 'lucide-react'
import type { BinSummary, ProjectBinPlacement } from '@/types'
import { GRID_UNIT } from '@/lib/constants'
import { DEFAULT_BIN_COLOR, binFootprint, binHeightMm, gridLines, placementRect, rotationOffsetMm } from '@/lib/drawerLayout'

interface Props {
  bins: Map<string, BinSummary>
  placements: ProjectBinPlacement[]
  drawerX: number
  drawerY: number
  selectedPlacementId: string | null
  overlapping: Set<string>
  outOfBounds: Set<string>
  /** STL url per bin id; bins without one fall back to a plain block. */
  stlUrls: Map<string, string>
  onSelect: (placementId: string | null) => void
}

type CameraView = 'home' | 'top' | 'front' | 'right' | 'fit'
type RenderMode = 'solid' | 'edges'

const BIN_OVERLAP_COLOR = '#ef4444'
const BIN_OUT_OF_BOUNDS_COLOR = '#f59e0b'
const VIEW_EVENT = 'drawer-sketch-view'

/** Darkened variant of a bin colour, used for its contour lines. */
function edgeColor(color: string): string {
  return `#${new THREE.Color(color).multiplyScalar(0.35).getHexString()}`
}

/** Lighter variant of a bin colour, marking the selected placement. */
function selectedColor(color: string): string {
  return `#${new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45).getHexString()}`
}

// three.js is y-up: drawer x maps to x, drawer y (top down) maps to z.
// geometry is declared as JSX so react-three-fiber owns the dispose lifecycle.

function DrawerFloor({ drawerX, drawerY }: { drawerX: number; drawerY: number }) {
  const widthMm = drawerX * GRID_UNIT
  const depthMm = drawerY * GRID_UNIT

  const gridPositions = useMemo(() => {
    const positions: number[] = []
    for (const unit of gridLines(drawerX)) {
      const x = unit * GRID_UNIT
      positions.push(x, 0.2, 0, x, 0.2, depthMm)
    }
    for (const unit of gridLines(drawerY)) {
      const z = unit * GRID_UNIT
      positions.push(0, 0.2, z, widthMm, 0.2, z)
    }
    return new Float32Array(positions)
  }, [drawerX, drawerY, widthMm, depthMm])

  return (
    <group>
      <mesh position={[widthMm / 2, 0, depthMm / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[widthMm, depthMm]} />
        <meshStandardMaterial color="#27272a" roughness={1} metalness={0} />
      </mesh>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#3f3f46" />
      </lineSegments>
    </group>
  )
}

/**
 * Loads the generated bin STL and normalises it to a y-up model whose corner
 * sits at the origin, so it lines up with the drawer grid like the 2D sketch.
 * Rendering matches the bin page preview: solid body plus sharp contour lines.
 */
function BinStlModel({ url, color, renderMode }: { url: string; color: string; renderMode: RenderMode }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [edges, setEdges] = useState<THREE.EdgesGeometry | null>(null)

  useEffect(() => {
    let disposed = false
    let loadedGeo: THREE.BufferGeometry | null = null
    let loadedEdges: THREE.EdgesGeometry | null = null

    new STLLoader().load(
      url,
      geo => {
        if (disposed) { geo.dispose(); return }
        // STL is z-up; match the drawer axes and put the corner at the origin
        geo.rotateX(-Math.PI / 2)
        geo.computeBoundingBox()
        const box = geo.boundingBox!
        geo.translate(-box.min.x, -box.min.y, -box.min.z)
        geo.computeVertexNormals()
        loadedGeo = geo
        loadedEdges = new THREE.EdgesGeometry(geo, 30)
        setGeometry(geo)
        setEdges(loadedEdges)
      },
      undefined,
      () => setGeometry(null),
    )

    return () => {
      disposed = true
      loadedGeo?.dispose()
      loadedEdges?.dispose()
      setGeometry(null)
      setEdges(null)
    }
  }, [url])

  if (!geometry) return null

  return (
    <>
      {renderMode === 'solid' ? (
        <mesh geometry={geometry}>
          <meshStandardMaterial color={color} metalness={0} roughness={0.7} />
        </mesh>
      ) : (
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#27272a" metalness={0} roughness={1} transparent opacity={0.3} />
        </mesh>
      )}
      {edges && (
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={renderMode === 'solid' ? edgeColor(color) : color} linewidth={1} />
        </lineSegments>
      )}
    </>
  )
}

function BinBlock({ widthMm, depthMm, heightMm, color }: {
  widthMm: number
  depthMm: number
  heightMm: number
  color: string
}) {
  return (
    <mesh position={[widthMm / 2, heightMm / 2, depthMm / 2]}>
      <boxGeometry args={[widthMm, heightMm, depthMm]} />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0} transparent opacity={0.45} />
    </mesh>
  )
}

function PlacedBin({
  bin,
  placement,
  color,
  stlUrl,
  renderMode,
  onSelect,
}: {
  bin: BinSummary
  placement: ProjectBinPlacement
  color: string
  stlUrl?: string
  renderMode: RenderMode
  onSelect: (placementId: string) => void
}) {
  const rect = placementRect(placement, bin)
  const footprint = binFootprint(bin, placement.rotation)
  const offset = rotationOffsetMm(placement.rotation, bin)

  const outlinePositions = useMemo(() => {
    const w = footprint.w * GRID_UNIT
    const d = footprint.h * GRID_UNIT
    return new Float32Array([
      0, 0.3, 0,
      w, 0.3, 0,
      w, 0.3, d,
      0, 0.3, d,
    ])
  }, [footprint.w, footprint.h])

  return (
    <group
      position={[rect.x * GRID_UNIT, 0, rect.y * GRID_UNIT]}
      onClick={event => { event.stopPropagation(); onSelect(placement.id) }}
    >
      {/* rotate the model about the drawer's vertical axis, then shift it back into its footprint */}
      <group position={[offset.dx, 0, offset.dz]} rotation={[0, -placement.rotation * Math.PI / 180, 0]}>
        {stlUrl
          ? <BinStlModel url={stlUrl} color={color} renderMode={renderMode} />
          : (
            <BinBlock
              widthMm={bin.grid_x * GRID_UNIT}
              depthMm={bin.grid_y * GRID_UNIT}
              heightMm={binHeightMm(bin.height_units)}
              color={color}
            />
          )}
      </group>
      {/* footprint outline keeps overlaps readable even behind a solid model */}
      <lineLoop>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[outlinePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineLoop>
    </group>
  )
}

// sits inside <Bounds>, listens for view commands via custom event
function CameraController() {
  const bounds = useBounds()
  const { camera } = useThree()
  const controls = useThree(s => s.controls) as { update?: () => void } | null
  const fittedRef = useRef(false)

  // fit once on initial load only
  useEffect(() => {
    if (fittedRef.current) return
    fittedRef.current = true
    const t = setTimeout(() => bounds.refresh().fit(), 50)
    return () => clearTimeout(t)
  }, [bounds])

  useEffect(() => {
    function handleView(e: Event) {
      const view = (e as CustomEvent<CameraView>).detail
      const dist = camera.position.length() || 400

      switch (view) {
        case 'home':
          camera.position.set(0, dist * 0.7, dist * 0.7)
          break
        case 'top':
          camera.position.set(0, dist, 0.01)
          break
        case 'front':
          camera.position.set(0, 0.01, dist)
          break
        case 'right':
          camera.position.set(dist, 0.01, 0.01)
          break
        case 'fit':
          bounds.refresh().fit()
          return
      }

      camera.lookAt(0, 0, 0)
      controls?.update?.()
    }

    window.addEventListener(VIEW_EVENT, handleView)
    return () => window.removeEventListener(VIEW_EVENT, handleView)
  }, [bounds, camera, controls])

  return null
}

const viewButtons: { view: CameraView; icon: typeof Box; label: string }[] = [
  { view: 'home', icon: RotateCcw, label: 'Home' },
  { view: 'top', icon: ArrowUp, label: 'Top' },
  { view: 'front', icon: CircleDot, label: 'Front' },
  { view: 'right', icon: ArrowRight, label: 'Right' },
  { view: 'fit', icon: Box, label: 'Fit' },
]

export function DrawerSketch3D({
  bins,
  placements,
  drawerX,
  drawerY,
  selectedPlacementId,
  overlapping,
  outOfBounds,
  stlUrls,
  onSelect,
}: Props) {
  const [renderMode, setRenderMode] = useState<RenderMode>('solid')
  const widthMm = drawerX * GRID_UNIT
  const depthMm = drawerY * GRID_UNIT
  const span = Math.max(widthMm, depthMm)

  const dispatchView = useCallback((view: CameraView) => {
    window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: view }))
  }, [])

  return (
    <div className="w-full h-full min-h-[300px] relative">
      <Canvas
        camera={{ position: [0, span * 0.85, span * 0.85], fov: 50, near: 1, far: span * 20 }}
        style={{ background: '#0d0d0f' }}
        onPointerMissed={() => onSelect(null)}
      >
        <hemisphereLight args={['#e8f8ff', '#8899aa', 1.4]} />
        <directionalLight position={[widthMm, span * 1.5, depthMm]} intensity={0.7} />

        <Suspense fallback={null}>
          <Bounds clip margin={1.15}>
            <group position={[-widthMm / 2, 0, -depthMm / 2]}>
              <DrawerFloor drawerX={drawerX} drawerY={drawerY} />
              {placements.map(placement => {
                const bin = bins.get(placement.bin_id)
                if (!bin) return null
                const base = overlapping.has(placement.id)
                  ? BIN_OVERLAP_COLOR
                  : outOfBounds.has(placement.id)
                    ? BIN_OUT_OF_BOUNDS_COLOR
                    : placement.color || DEFAULT_BIN_COLOR
                // selection lightens the bin's own colour instead of replacing it
                const color = selectedPlacementId === placement.id ? selectedColor(base) : base
                return (
                  <PlacedBin
                    key={placement.id}
                    bin={bin}
                    placement={placement}
                    color={color}
                    stlUrl={stlUrls.get(bin.id)}
                    renderMode={renderMode}
                    onSelect={onSelect}
                  />
                )
              })}
            </group>
            <CameraController />
          </Bounds>
        </Suspense>

        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.8} />
        </GizmoHelper>
        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={span * 0.15}
          maxDistance={span * 4}
          makeDefault
        />
      </Canvas>

      <div className="absolute top-3 left-3 flex gap-1">
        {viewButtons.map(({ view, icon: Icon, label }) => (
          <button
            key={view}
            onClick={() => dispatchView(view)}
            className="p-1.5 rounded bg-surface/80 hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            title={label}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
        <div className="w-px bg-border mx-0.5" />
        <button
          onClick={() => setRenderMode(m => m === 'solid' ? 'edges' : 'solid')}
          className={`p-1.5 rounded transition-colors ${
            renderMode === 'edges'
              ? 'bg-accent-muted text-accent'
              : 'bg-surface/80 hover:bg-elevated text-text-secondary hover:text-text-primary'
          }`}
          title="Toggle edges"
        >
          <Triangle className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
