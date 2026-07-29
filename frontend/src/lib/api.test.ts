import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPhotoStation,
  reusePhotoStationCorners,
  setCorners,
  uploadImage,
} from './api'
import type { CaptureCrop, Point } from '@/types'

function jsonResponse(body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(jsonResponse())
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api photo station requests', () => {
  it('sends a station name when saving corners as a station', async () => {
    const corners: Point[] = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]

    await setCorners('session-1', corners, 'letter', 'Bench station')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/sessions/session-1/corners',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          corners,
          paper_size: 'letter',
          save_station_name: 'Bench station',
        }),
      }),
    )
  })

  it('creates photo stations with paper size and corner data', async () => {
    const corners: Point[] = [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: 10, y: 40 },
    ]

    await createPhotoStation({
      name: 'Assembly bench',
      session_id: 'session-2',
      paper_size: 'a3',
      corners,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/photo-stations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Assembly bench',
          session_id: 'session-2',
          paper_size: 'a3',
          corners,
        }),
      }),
    )
  })

  it('posts the selected station id when reusing corners', async () => {
    await reusePhotoStationCorners('session-3', 'station-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/sessions/session-3/reuse-corners',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ station_id: 'station-1' }),
      }),
    )
  })

  it('includes station and crop metadata in capture uploads', async () => {
    const crop: CaptureCrop = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }

    await uploadImage(new File(['image'], 'capture.jpg', { type: 'image/jpeg' }), 'station-2', crop)

    const [, request] = fetchMock.mock.calls[0]
    expect(request).toMatchObject({ method: 'POST' })
    expect(request.body).toBeInstanceOf(FormData)
    const formData = request.body as FormData
    expect(formData.get('station_id')).toBe('station-2')
    expect(formData.get('capture_crop')).toBe(JSON.stringify(crop))
  })
})
