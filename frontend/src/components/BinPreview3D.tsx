'use client'

import { Suspense, useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Bounds, useBounds } from '@react-three/drei'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { Box, RotateCcw, ArrowUp, ArrowRight, CircleDot, Triangle } from 'lucide-react'

interface Props {
  stlUrl: string
  splitUrls?: string[]
}

type CameraView = 'home' | 'top' | 'front' | 'right' | 'fit'

type RenderMode = 'solid' | 'edges'

function StlModel({ url, renderMode }: { url: string; renderMode: RenderMode }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [edgesGeometry, setEdgesGeometry] = useState<THREE.EdgesGeometry | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const loader = new STLLoader()
    let disposed = false
    let loadedGeo: THREE.BufferGeometry | null = null
    let loadedEdges: THREE.EdgesGeometry | null = null

    loader.load(
      url,
      (geo) => {
        if (disposed) { geo.dispose(); return }
        geo.computeVertexNormals()

        geo.computeBoundingBox()
        const box = geo.boundingBox!
        const centerX = (box.max.x + box.min.x) / 2
        const centerY = (box.max.y + box.min.y) / 2
        const minZ = box.min.z

        geo.translate(-centerX, -centerY, -minZ)
        loadedGeo = geo
        loadedEdges = new THREE.EdgesGeometry(geo, 30)
        setGeometry(geo)
        setEdgesGeometry(loadedEdges)
      },
      () => {},
      (err) => {
        console.error('STL load error:', err)
        setLoadError(String(err))
      }
    )

    return () => {
      disposed = true
      loadedGeo?.dispose()
      loadedEdges?.dispose()
    }
  }, [url])

  if (loadError || !geometry) return null

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {renderMode === 'solid' ? (
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#4a9eff" metalness={0.3} roughness={0.4} />
        </mesh>
      ) : (
        <>
          <mesh geometry={geometry}>
            <meshStandardMaterial color="#1e293b" metalness={0} roughness={1} transparent opacity={0.3} />
          </mesh>
          {edgesGeometry && (
            <lineSegments geometry={edgesGeometry}>
              <lineBasicMaterial color="#4a9eff" linewidth={1} />
            </lineSegments>
          )}
        </>
      )}
    </group>
  )
}

const SPLIT_PIECE_COLORS = ['#4a9eff', '#ff6b4a', '#4aff9e', '#ff4adb']

function SplitModels({ urls, renderMode }: { urls: string[]; renderMode: RenderMode }) {
  const [pieces, setPieces] = useState<{ geo: THREE.BufferGeometry; edges: THREE.EdgesGeometry; offset: number }[]>([])

  useEffect(() => {
    const loader = new STLLoader()
    let cancelled = false
    let loadedPieces: { geo: THREE.BufferGeometry; edges: THREE.EdgesGeometry }[] = []

    Promise.all(urls.map(url =>
      new Promise<THREE.BufferGeometry | null>((resolve) => {
        loader.load(url, (geo) => { geo.computeVertexNormals(); resolve(geo) }, () => {}, () => resolve(null))
      })
    )).then(results => {
      const geos = results.filter((g): g is THREE.BufferGeometry => g !== null)
      if (geos.length === 0) return
      if (cancelled) {
        geos.forEach(g => g.dispose())
        return
      }

      const GAP = 10
      const boxes = geos.map(g => { g.computeBoundingBox(); return g.boundingBox! })
      const totalWidth = boxes.reduce((sum, b) => sum + (b.max.x - b.min.x), 0) + GAP * (geos.length - 1)
      let xOffset = -totalWidth / 2

      const result = geos.map((geo, i) => {
        const box = boxes[i]
        const w = box.max.x - box.min.x
        const centerY = (box.max.y + box.min.y) / 2
        const minZ = box.min.z
        geo.translate(-((box.max.x + box.min.x) / 2) + xOffset + w / 2, -centerY, -minZ)
        xOffset += w + GAP
        const edges = new THREE.EdgesGeometry(geo, 30)
        return { geo, edges, offset: 0 }
      })

      loadedPieces = result
      setPieces(result)
    })

    return () => {
      cancelled = true
      loadedPieces.forEach(p => { p.geo.dispose(); p.edges.dispose() })
    }
  }, [urls])

  if (pieces.length === 0) return null

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {pieces.map((piece, i) => (
        <group key={i}>
          {renderMode === 'solid' ? (
            <mesh geometry={piece.geo}>
              <meshStandardMaterial color={SPLIT_PIECE_COLORS[i % SPLIT_PIECE_COLORS.length]} metalness={0.3} roughness={0.4} />
            </mesh>
          ) : (
            <>
              <mesh geometry={piece.geo}>
                <meshStandardMaterial color="#1e293b" metalness={0} roughness={1} transparent opacity={0.3} />
              </mesh>
              <lineSegments geometry={piece.edges}>
                <lineBasicMaterial color={SPLIT_PIECE_COLORS[i % SPLIT_PIECE_COLORS.length]} linewidth={1} />
              </lineSegments>
            </>
          )}
        </group>
      ))}
    </group>
  )
}

// sits inside <Bounds>, listens for view commands via custom event
function CameraController() {
  const bounds = useBounds()
  const { camera } = useThree()
  const controls = useThree(s => s.controls) as any

  // fit on initial load
  useEffect(() => {
    const t = setTimeout(() => bounds.refresh().fit(), 50)
    return () => clearTimeout(t)
  }, [bounds])

  useEffect(() => {
    function handleView(e: Event) {
      const view = (e as CustomEvent<CameraView>).detail
      const dist = camera.position.length() || 200

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

    window.addEventListener('bin-preview-view', handleView)
    return () => window.removeEventListener('bin-preview-view', handleView)
  }, [bounds, camera, controls])

  return null
}

function GridFloor() {
  return (
    <gridHelper
      args={[300, 30, '#334155', '#1e293b']}
      rotation={[0, 0, 0]}
      position={[0, 0, 0]}
    />
  )
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[20, 20, 20]} />
      <meshStandardMaterial color="#334155" wireframe />
    </mesh>
  )
}

const viewButtons: { view: CameraView; icon: typeof Box; label: string }[] = [
  { view: 'home', icon: RotateCcw, label: 'Home' },
  { view: 'top', icon: ArrowUp, label: 'Top' },
  { view: 'front', icon: CircleDot, label: 'Front' },
  { view: 'right', icon: ArrowRight, label: 'Right' },
  { view: 'fit', icon: Box, label: 'Fit' },
]

export function BinPreview3D({ stlUrl, splitUrls }: Props) {
  const [renderMode, setRenderMode] = useState<RenderMode>('solid')
  const dispatchView = useCallback((view: CameraView) => {
    window.dispatchEvent(new CustomEvent('bin-preview-view', { detail: view }))
  }, [])

  return (
    <div className="w-full h-full min-h-[400px] relative">
      <Canvas
        camera={{ position: [0, 250, 250], fov: 50 }}
        style={{ background: '#0f172a' }}
      >
        <ambientLight intensity={0.2} />
        <directionalLight position={[10, 20, 10]} intensity={0.4} />
        <directionalLight position={[-10, -10, -10]} intensity={0.15} />

        <Suspense fallback={<LoadingFallback />}>
          <Bounds fit clip observe margin={1.15}>
            {splitUrls && splitUrls.length > 0 ? (
              <SplitModels urls={splitUrls} renderMode={renderMode} />
            ) : (
              <StlModel url={stlUrl} renderMode={renderMode} />
            )}
            <CameraController />
          </Bounds>
        </Suspense>

        <GridFloor />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.8} />
        </GizmoHelper>
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={50}
          maxDistance={500}
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
              ? 'bg-accent-muted text-blue-400'
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
