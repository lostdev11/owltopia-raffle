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
const IRYS_GATEWAY_HOSTS = new Set(['gateway.irys.xyz', 'ardrive.net'])

export function isIrysUploaderHttpsUrl(urlStr: string): boolean {
  try {
    return IRYS_UPLOADER_HOSTS.has(new URL(urlStr.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}

export function isIrysGatewayHttpsUrl(urlStr: string): boolean {
  try {
    return IRYS_GATEWAY_HOSTS.has(new URL(urlStr.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * gateway.irys.xyz / ardrive.net often hang in mobile browsers; the same Arweave path usually resolves.
 */
export function irysGatewayMirrorHttpsUrls(urlStr: string): string[] {
  try {
    const u = new URL(urlStr.trim())
    if (!IRYS_GATEWAY_HOSTS.has(u.hostname.toLowerCase())) return [urlStr]
    const path = u.pathname + u.search + u.hash
    return [
      ...new Set([
        `https://arweave.net${path}`,
        `https://arweave.dev${path}`,
        `https://uploader.irys.xyz${path}`,
        urlStr,
      ]),
    ]
  } catch {
    return [urlStr]
  }
}

/** Best browser-facing HTTPS URL for on-chain NFT artwork metadata. */
export function preferredNftImageHttpsUrl(urlStr: string): string {
  const trimmed = urlStr.trim()
  if (!trimmed) return trimmed
  if (isIrysGatewayHttpsUrl(trimmed)) {
    return irysGatewayMirrorHttpsUrls(trimmed)[0] ?? trimmed
  }
  if (isIrysUploaderHttpsUrl(trimmed)) {
    const mirrors = irysUploaderMirrorHttpsUrls(trimmed)
    return mirrors.find((m) => m.startsWith('https://arweave.net')) ?? mirrors[0] ?? trimmed
  }
  return trimmed
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
