/**
 * Decode query params that were encoded more than once (older clients / edge proxies).
 */
export function fullyDecodeURIComponentSafe(raw: string): string {
  let s = raw.trim()
  for (let i = 0; i < 8; i++) {
    try {
      const next = decodeURIComponent(s)
      if (next === s) break
      s = next
    } catch {
      break
    }
  }
  return s
}

/** Metaplex-style `ar://<txId>` → HTTPS gateway. */
export function arweaveUriToHttps(uri: string): string | null {
  const t = uri.trim()
  if (!/^ar:\/\//i.test(t)) return null
  const rest = t.replace(/^ar:\/\//i, '').replace(/^\/+/, '')
  const id = rest.split(/[/?#]/)[0]
  if (!id) return null
  return `https://arweave.net/${id}`
}
