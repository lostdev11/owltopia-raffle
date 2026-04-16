/**
 * Central Solana HTTP RPC resolution.
 *
 * - **Local `next dev`:** `NEXT_PUBLIC_DEV_SOLANA_RPC_URL` / `SOLANA_RPC_DEV_URL` override paid RPCs.
 * - **Vercel Preview:** when `NEXT_PUBLIC_PREVIEW_SOLANA_RPC_URL` (and optional `SOLANA_RPC_PREVIEW_URL`) are set,
 *   they override production URLs so branch deploys do not spend Helius credits (`VERCEL_ENV` is forwarded as
 *   `NEXT_PUBLIC_VERCEL_DEPLOY_ENV` in `next.config.js`).
 * - **Vercel Production:** uses `NEXT_PUBLIC_SOLANA_RPC_URL` / `SOLANA_RPC_URL` only.
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

function isVercelPreviewDeploy(): boolean {
  return process.env.NEXT_PUBLIC_VERCEL_DEPLOY_ENV === 'preview'
}

/**
 * Browser / wallet adapter RPC. Dev overrides first; then optional Preview-only URL on Vercel Preview.
 */
export function resolvePublicSolanaRpcUrl(): string {
  if (isDevelopment()) {
    const dev = process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim()
    if (dev) return sanitizeRpcUrl(dev)
  }
  if (isVercelPreviewDeploy()) {
    const preview = process.env.NEXT_PUBLIC_PREVIEW_SOLANA_RPC_URL?.trim()
    if (preview) return sanitizeRpcUrl(preview)
  }
  const main = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
  if (main) return sanitizeRpcUrl(main)
  return DEFAULT_PUBLIC_RPC
}

/**
 * HTTP RPC for the wallet adapter `Connection` (balances, token accounts, sends).
 * When `NEXT_PUBLIC_WALLET_READ_RPC_URL` is set (production), uses it so read-heavy wallet traffic
 * can avoid billing Helius while `NEXT_PUBLIC_SOLANA_RPC_URL` remains available for cluster/explorer logic.
 * Dev / Preview still prefer `NEXT_PUBLIC_DEV_SOLANA_RPC_URL` / `NEXT_PUBLIC_PREVIEW_SOLANA_RPC_URL` when set.
 */
export function resolveWalletAdapterRpcUrl(): string {
  if (isDevelopment()) {
    const dev = process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim()
    if (dev) return sanitizeRpcUrl(dev)
  }
  if (isVercelPreviewDeploy()) {
    const preview = process.env.NEXT_PUBLIC_PREVIEW_SOLANA_RPC_URL?.trim()
    if (preview) return sanitizeRpcUrl(preview)
  }
  const walletRead = process.env.NEXT_PUBLIC_WALLET_READ_RPC_URL?.trim()
  if (walletRead) return sanitizeRpcUrl(walletRead)
  return resolvePublicSolanaRpcUrl()
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
  if (isVercelPreviewDeploy()) {
    const preview =
      process.env.SOLANA_RPC_PREVIEW_URL?.trim() ||
      process.env.NEXT_PUBLIC_PREVIEW_SOLANA_RPC_URL?.trim()
    if (preview) return sanitizeRpcUrl(preview)
  }
  const server = process.env.SOLANA_RPC_URL?.trim()
  if (server) return sanitizeRpcUrl(server)
  const pub = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
  if (pub) return sanitizeRpcUrl(pub)
  return DEFAULT_SERVER_RPC
}
