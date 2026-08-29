// export artefacts are purged after the retention window (docs/stl-generation.md);
// a 404 means the file expired, so regenerate and retry once instead of
// surfacing the raw json error to the user

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const utf8 = /filename\*=utf-8''([^;]+)/i.exec(header)
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim())
    } catch {
      return null
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1].trim() : null
}

function fallbackFilename(url: string): string {
  const path = url.split(/[?#]/)[0]
  return path.split('/').pop() || 'download'
}

export async function downloadExport(url: string, regenerate: () => Promise<void>): Promise<void> {
  let response = await fetch(url)
  if (response.status === 404) {
    await regenerate()
    response = await fetch(url)
  }
  if (!response.ok) {
    throw new Error(`export download failed (${response.status})`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackFilename(url)
  link.click()
  URL.revokeObjectURL(objectUrl)
}
