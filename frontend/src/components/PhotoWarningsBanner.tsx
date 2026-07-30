'use client'

import { Alert } from '@/components/Alert'
import { DOCS_BASE_URL } from '@/lib/constants'
import type { PhotoWarning } from '@/types'

export const PHOTO_GUIDE_URL = `${DOCS_BASE_URL}/usage/uploading-photos.md`

interface Props {
  warnings: PhotoWarning[]
  onDismiss: () => void
}

export function PhotoWarningsBanner({ warnings, onDismiss }: Props) {
  if (warnings.length === 0) return null

  return (
    <Alert variant="warning">
      <div className="space-y-1.5">
        {warnings.map((w) => (
          <p key={w.code}>{w.message}</p>
        ))}
        <p>
          <a
            href={PHOTO_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            See the photo guide
          </a>
          {' · '}
          <button type="button" onClick={onDismiss} className="underline">
            Dismiss
          </button>
        </p>
      </div>
    </Alert>
  )
}
