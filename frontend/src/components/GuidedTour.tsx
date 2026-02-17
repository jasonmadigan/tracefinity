'use client'

import { PhotoIllustration, CornersIllustration, TraceIllustration, OrganiseIllustration } from './OnboardingIllustrations'

interface Props {
  open: boolean
  onClose: () => void
}

const STEPS = [
  { Illustration: PhotoIllustration, label: '1. Photograph', caption: 'Place your tools on a sheet of A4 or Letter paper and take a photo from above.' },
  { Illustration: CornersIllustration, label: '2. Adjust corners', caption: 'Drag the corner handles to match the paper edges. This gives us the scale.' },
  { Illustration: TraceIllustration, label: '3. Trace', caption: 'AI generates a silhouette mask and traces the tool outlines automatically.' },
  { Illustration: OrganiseIllustration, label: '4. Organise & export', caption: 'Arrange tools in a gridfinity bin layout and download the STL for 3D printing.' },
]

export function GuidedTour({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-lg shadow-2xl max-w-lg w-full mx-4 p-5 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-text-primary">How it works</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STEPS.map(({ Illustration, label, caption }) => (
            <div key={label} className="bg-inset rounded-lg overflow-hidden border border-border">
              <div className="p-3 pb-2">
                <Illustration />
              </div>
              <div className="px-3 pb-3">
                <p className="text-xs font-medium text-text-secondary">{label}</p>
                <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{caption}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-primary px-4 py-1.5 text-xs">
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
