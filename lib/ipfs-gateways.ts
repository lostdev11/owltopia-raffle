/**
 * Public IPFS HTTPS gateway bases (ordered). Do not use cloudflare-ipfs.com — Cloudflare
 * shut down that hostname (see Cloudflare Web3 migration guide).
 */
export const IPFS_HTTPS_GATEWAY_PREFIXES = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
] as const

const IPFS_PATH_MARKER = '/ipfs/'

export function ipfsUriToHttpsGatewayUrl(uri: string): string | null {
  const t = uri.trim()
  if (!/^ipfs:\/\//i.test(t)) return null
  const path = t.replace(/^ipfs:\/\//i, '').replace(/^\/+/, '')
  if (!path) return null
  return `${IPFS_HTTPS_GATEWAY_PREFIXES[0]}${path}`
}

/** CID and optional subpath after `/ipfs/` in any gateway URL. */
export function extractIpfsContentPath(urlStr: string): string | null {
  const lower = urlStr.toLowerCase()
  const i = lower.lastIndexOf(IPFS_PATH_MARKER)
  if (i === -1) return null
  const rest = urlStr.slice(i + IPFS_PATH_MARKER.length).trim()
  return rest || null
}

/** Try original URL first, then the same content on other gateways (full path preserved). */
export function ipfsGatewayCandidateUrls(originalHttpsUrl: string): string[] {
  const pathAfter = extractIpfsContentPath(originalHttpsUrl)
  if (!pathAfter) return [originalHttpsUrl]
  const alternates = IPFS_HTTPS_GATEWAY_PREFIXES.map((p) => `${p}${pathAfter}`)
  const ordered = [originalHttpsUrl, ...alternates.filter((u) => u !== originalHttpsUrl)]
  return [...new Set(ordered)]
}
