/**
 * Central Solana HTTP RPC resolution.
 *
 * In development, optional dev-only URLs avoid burning paid credits (e.g. Helius) during `next dev`.
 * Production ignores dev overrides.
 */

function sanitizeRpcUrl(rpcUrl: string): string {
  let u = rpcUrl.trim()
  if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
    if (!u.includes('://')) u = `https://${u}`
    else u = 'https://api.mainnet-beta.solana.com'
  }
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    return 'https://api.mainnet-beta.solana.com'
  }
  return u
}

const DEFAULT_SERVER_RPC = 'https://api.mainnet-beta.solana.com'
/** Matches WalletProvider when NEXT_PUBLIC_SOLANA_RPC_URL is unset */
const DEFAULT_PUBLIC_RPC = 'https://solana.drpc.org'

function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}

/**
 * Browser / wallet adapter RPC. Uses NEXT_PUBLIC_DEV_SOLANA_RPC_URL only when NODE_ENV === 'development'.
 */
export function resolvePublicSolanaRpcUrl(): string {
  if (isDevelopment()) {
    const dev = process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim()
    if (dev) return sanitizeRpcUrl(dev)
  }
  const main = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
  if (main) return sanitizeRpcUrl(main)
  return DEFAULT_PUBLIC_RPC
}

/**
 * Server JSON-RPC (API routes, verification, escrow). Prefer SOLANA_RPC_DEV_URL in dev, else same dev public URL.
 */
export function resolveServerSolanaRpcUrl(): string {
  if (isDevelopment()) {
    const dev =
      process.env.SOLANA_RPC_DEV_URL?.trim() ||
      process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim()
    if (dev) return sanitizeRpcUrl(dev)
  }
  const server = process.env.SOLANA_RPC_URL?.trim()
  if (server) return sanitizeRpcUrl(server)
  const pub = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
  if (pub) return sanitizeRpcUrl(pub)
  return DEFAULT_SERVER_RPC
}
