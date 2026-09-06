// Only the server reads the origin list. Invalid or absent configuration keeps
// the ordinary home-page destination; a query parameter cannot extend the list.
export function loginReturnDestination(value: unknown, configuredOrigins?: string): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return '/'
  try {
    const destination = new URL(value)
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) return '/'
    const origins: unknown = JSON.parse(configuredOrigins || '[]')
    if (!Array.isArray(origins)) return '/'
    const approved = origins.some((entry: unknown) => {
      if (typeof entry !== 'string') return false
      try {
        const origin = new URL(entry)
        return origin.origin === destination.origin &&
          entry === origin.origin && ['http:', 'https:'].includes(origin.protocol)
      } catch {
        return false
      }
    })
    return approved ? destination.href : '/'
  } catch {
    return '/'
  }
}
