// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadExport } from './download'

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    blob: async () => new Blob(['solid bin']),
  } as unknown as Response
}

describe('downloadExport', () => {
  let clicks: { href: string; download: string }[]

  beforeEach(() => {
    clicks = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download })
    })
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('downloads via an anchor click using the server filename', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockResponse(200, { 'content-disposition': 'attachment; filename="Bin_2u3u6u_20mm-tracefinity.stl"' })
    ))
    const regenerate = vi.fn()

    await downloadExport('http://api/api/files/bins/b1/bin.stl', regenerate)

    expect(regenerate).not.toHaveBeenCalled()
    expect(clicks).toEqual([{ href: 'blob:mock', download: 'Bin_2u3u6u_20mm-tracefinity.stl' }])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('regenerates and retries once when the export has been purged', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(404))
      .mockResolvedValueOnce(mockResponse(200, { 'content-disposition': 'attachment; filename="bin.stl"' }))
    vi.stubGlobal('fetch', fetchMock)
    const regenerate = vi.fn(async () => {})

    await downloadExport('http://api/api/files/bins/b1/bin.stl', regenerate)

    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(clicks).toEqual([{ href: 'blob:mock', download: 'bin.stl' }])
  })

  it('throws when the export is still missing after regenerating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(404)))
    const regenerate = vi.fn(async () => {})

    await expect(downloadExport('http://api/api/files/bins/b1/bin.stl', regenerate))
      .rejects.toThrow('export download failed (404)')

    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([])
  })

  it('throws on non-404 errors without regenerating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(500)))
    const regenerate = vi.fn()

    await expect(downloadExport('http://api/api/files/bins/b1/bin.stl', regenerate))
      .rejects.toThrow('export download failed (500)')

    expect(regenerate).not.toHaveBeenCalled()
  })

  it('falls back to the url basename when no disposition header is readable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200)))

    await downloadExport('http://api/api/files/bins/b1/bin_parts.zip?v=3', vi.fn())

    expect(clicks).toEqual([{ href: 'blob:mock', download: 'bin_parts.zip' }])
  })

  it('decodes rfc 5987 encoded filenames', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockResponse(200, { 'content-disposition': "attachment; filename*=utf-8''caf%C3%A9.stl" })
    ))

    await downloadExport('http://api/api/files/bins/b1/bin.stl', vi.fn())

    expect(clicks).toEqual([{ href: 'blob:mock', download: 'café.stl' }])
  })
})
