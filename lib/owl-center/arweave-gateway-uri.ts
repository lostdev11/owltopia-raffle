/** Extract Arweave/Irys transaction id from common HTTPS gateways. */
export function arweaveTxIdFromHttps(uri: string): string | null {
  const t = uri.trim()
  if (!t) return null
  try {
    const u = new URL(t)
    const id = u.pathname.replace(/^\//, '').split('/')[0]?.trim()
    return id || null
  } catch {
    return null
  }
}

/** Prefer a gateway that serves raw JSON/PNG to wallets (not the arweave.net HTML shell). */
export function normalizeOwlCenterArweaveGatewayUri(uri: string, network: 'mainnet' | 'devnet' = 'mainnet'): string {
  const id = arweaveTxIdFromHttps(uri)
  if (!id) return uri.trim()
  const host = network === 'devnet' ? 'arweave.dev' : 'gateway.irys.xyz'
  return `https://${host}/${id}`
}

/** Mobile wallets (Solflare) often fail on arweave.net shells and flaky Irys gateway fetches. */
export function walletSafeArweaveGatewayUri(uri: string, network: 'mainnet' | 'devnet' = 'mainnet'): string {
  const id = arweaveTxIdFromHttps(uri)
  if (!id) return uri.trim()
  const host = network === 'devnet' ? 'arweave.dev' : 'ar-io.net'
  return `https://${host}/${id}`
}
