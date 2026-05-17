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

const IRYS_UPLOADER_HOSTS = new Set(['uploader.irys.xyz', 'cdn.irys.xyz'])

export function isIrysUploaderHttpsUrl(urlStr: string): boolean {
  try {
    return IRYS_UPLOADER_HOSTS.has(new URL(urlStr.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Bundlr/Irys upload CDN often RSTs or blocks automated fetches; the same path usually works on Arweave gateways.
 */
export function irysUploaderMirrorHttpsUrls(urlStr: string): string[] {
  try {
    const u = new URL(urlStr.trim())
    if (!IRYS_UPLOADER_HOSTS.has(u.hostname.toLowerCase())) return [urlStr]
    const path = u.pathname + u.search + u.hash
    const candidates = [
      urlStr,
      `https://arweave.net${path}`,
      `https://arweave.dev${path}`,
      `https://gateway.irys.xyz${path}`,
    ]
    return [...new Set(candidates)]
  } catch {
    return [urlStr]
  }
}
