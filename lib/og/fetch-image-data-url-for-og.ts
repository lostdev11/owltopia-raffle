/**
 * Pre-fetches a remote art URL so `next/og` / Satori does not block on a slow
 * `<img src={https...} />` when Twitter/X crawls (tight timeout → gray card otherwise).
 */
const DEFAULT_UA = 'OwltopiaImageBot/1.0 (+https://owltopia.xyz)'

const DEFAULT_TIMEOUT_MS = 2_500
const DEFAULT_MAX_BYTES = 1_500_000

function isSvg(mime: string, url: string) {
  if (mime === 'image/svg+xml') return true
  if (/\.svg([?#]|$)/i.test(url)) return true
  return false
}

/**
 * Returns a `data:` URL for use in Satori's <img/>, or null (placeholder art) on failure/timeout.
 */
export async function fetchImageDataUrlForOg(
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}
): Promise<string | null> {
  const s = url.trim()
  if (!s.startsWith('https://') && !s.startsWith('http://')) return null
  if (isSvg('', s)) return null

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(s, {
      signal: ac.signal,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    })
    if (!res.ok) return null

    const cl = res.headers.get('content-length')
    if (cl) {
      const n = parseInt(cl, 10)
      if (Number.isFinite(n) && n > maxBytes) return null
    }
    const mime = res.headers.get('content-type')?.split(';')[0].trim() ?? ''
    if (mime && !mime.startsWith('image/')) return null
    if (mime && isSvg(mime, s)) return null

    const buf = await res.arrayBuffer()
    if (buf.byteLength < 24 || buf.byteLength > maxBytes) return null
    const b64 = Buffer.from(buf).toString('base64')
    const contentType = mime && mime.startsWith('image/') ? mime : 'image/png'
    return `data:${contentType};base64,${b64}`
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
