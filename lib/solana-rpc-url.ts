/**
 * Central Solana HTTP RPC resolution.
 *
 * - **Local `next dev`:** `NEXT_PUBLIC_DEV_SOLANA_RPC_URL` / `SOLANA_RPC_DEV_URL` override paid RPCs.
 * - **Vercel Preview:** when `NEXT_PUBLIC_PREVIEW_SOLANA_RPC_URL` (and optional `SOLANA_RPC_PREVIEW_URL`) are set,
 *   they override production URLs so branch deploys do not spend Helius credits (`VERCEL_ENV` is forwarded as
 *   `NEXT_PUBLIC_VERCEL_DEPLOY_ENV` in `next.config.js`).
 * - **Vercel Production:** uses `NEXT_PUBLIC_SOLANA_RPC_URL` / `SOLANA_RPC_URL` only.
 */

import type { Connection } from '@solana/web3.js'

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

function normalizeRpcUrlForCompare(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Public devnet/mainnet RPC hosts do not implement DAS (getAsset proofs); cNFT transfers need Helius or similar. */
function isVanillaSolanaHttpRpc(url: string): boolean {
  const u = normalizeRpcUrlForCompare(url).toLowerCase()
  return (
    u.includes('api.devnet.solana.com') ||
    u.includes('api.mainnet-beta.solana.com') ||
    u.includes('api.testnet.solana.com') ||
    u.includes('solana.drpc.org')
  )
}

function inferClusterFromRpcUrl(url: string): 'devnet' | 'mainnet' {
  return /devnet/i.test(url) ? 'devnet' : 'mainnet'
}

/**
 * Browser-side Helius URL for DAS/Bubblegum when the app RPC is vanilla Solana (no indexer).
 * Set `NEXT_PUBLIC_HELIUS_RPC_URL` to a full Helius URL, or `NEXT_PUBLIC_HELIUS_API_KEY` to match
 * server `HELIUS_API_KEY` when you are OK exposing the key to the client (typical for local dev).
 */
function resolveHeliusBrowserDasRpcUrl(connection: Connection, candidate: string): string | null {
  const explicit = process.env.NEXT_PUBLIC_HELIUS_RPC_URL?.trim()
  if (explicit) return sanitizeRpcUrl(explicit)

  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY?.trim()
  if (!key) return null

  const hint =
    (((connection as any).rpcEndpoint ?? (connection as any)._rpcEndpoint ?? '') as string).trim() ||
    candidate ||
    resolvePublicSolanaRpcUrl()
  const cluster = inferClusterFromRpcUrl(hint)
  const base =
    cluster === 'devnet' ? 'https://devnet.helius-rpc.com' : 'https://mainnet.helius-rpc.com'
  return `${base}/?api-key=${encodeURIComponent(key)}`
}

/**
 * Metaplex Umi (Bubblegum DAS, MPL Core) needs JSON-RPC methods such as `getAsset` / proof APIs.
 * The wallet {@link Connection} often uses {@link resolveWalletAdapterRpcUrl} (cheap read RPC without DAS).
 * Use this helper so client-side compressed/Core transfers hit the primary app RPC (usually Helius-capable),
 * while SPL/token flows keep using the wallet Connection as today.
 */
export function resolveMetaplexClientRpcUrl(connection: Connection): string {
  const connRaw =
    ((connection as any).rpcEndpoint ?? (connection as any)._rpcEndpoint ?? '') as string
  const connUrl = normalizeRpcUrlForCompare(connRaw)
  const walletRead = normalizeRpcUrlForCompare(resolveWalletAdapterRpcUrl())
  const primary = normalizeRpcUrlForCompare(resolvePublicSolanaRpcUrl())

  let candidate = ''
  if (connUrl && walletRead && connUrl === walletRead && primary && primary !== walletRead) {
    candidate = primary
  } else {
    candidate = connRaw.trim() || resolvePublicSolanaRpcUrl()
  }

  const heliusDas = resolveHeliusBrowserDasRpcUrl(connection, candidate)
  if (heliusDas && isVanillaSolanaHttpRpc(candidate)) {
    return heliusDas
  }

  return candidate
}

/**
 * Server JSON-RPC for **read-heavy** calls (`getAccount`, `getParsedTokenAccountsByOwner`, etc.).
 * When unset, falls back to {@link resolveServerSolanaRpcUrl} (same as today).
 *
 * Do **not** rely on this for `getTransaction` / archival history, or for UMI + DAS / Bubblegum —
 * keep using the primary URL so Helius (or your paid RPC) handles tx fetch and indexer APIs.
 */
export function resolveServerSolanaReadRpcUrl(): string {
  const read = process.env.SOLANA_RPC_READ_URL?.trim()
  if (read) return sanitizeRpcUrl(read)
  return resolveServerSolanaRpcUrl()
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
