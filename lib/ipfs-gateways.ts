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

/**
 * nft.storage / web3.storage / Storacha use `{CID}.ipfs.*.link/path` — there is no `/ipfs/`
 * segment, so {@link ipfsGatewayCandidateUrls} would not try alternate gateways and the
 * subdomain host often stalls or dies while path-style `/ipfs/{CID}/...` still resolves.
 */
function rewriteSubdomainIpfsGatewayHttpsUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase()
    const m = host.match(/^([^.]+)\.ipfs\.((?:nftstorage|w3s|dweb|storacha)\.link)$/i)
    if (!m) return null
    const cid = m[1]
    const subpath = u.pathname.replace(/^\/+/, '')
    const afterIpfs = subpath ? `${cid}/${subpath}` : cid
    return `https://ipfs.io/ipfs/${afterIpfs}${u.search}${u.hash}`
  } catch {
    return null
  }
}

/**
 * Cloudflare shut down `cloudflare-ipfs.com`; metadata still references it.
 * Rewrite to a live gateway so our proxy and `<img>` fallbacks can fetch the CID.
 */
export function rewriteDeadIpfsGatewayHttpsUrl(urlStr: string): string {
  const raw = urlStr.trim()
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw
    const h = u.hostname.toLowerCase()
    if (h === 'cloudflare-ipfs.com' || h === 'www.cloudflare-ipfs.com') {
      return `https://ipfs.io${u.pathname}${u.search}${u.hash}`
    }
    const subdomain = rewriteSubdomainIpfsGatewayHttpsUrl(raw)
    if (subdomain) return subdomain
  } catch {
    /* ignore */
  }
  return raw
}

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
  const normalized = rewriteDeadIpfsGatewayHttpsUrl(originalHttpsUrl.trim())
  const pathAfter = extractIpfsContentPath(normalized)
  if (!pathAfter) return [normalized]
  const alternates = IPFS_HTTPS_GATEWAY_PREFIXES.map((p) => `${p}${pathAfter}`)
  const ordered = [normalized, ...alternates.filter((u) => u !== normalized)]
  return [...new Set(ordered)]
}
