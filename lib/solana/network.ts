import { sanitizeRpcUrl, resolvePublicSolanaRpcUrl, resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export type OwlMintNetwork = 'devnet' | 'mainnet'

/**
 * Solana cluster label (explorer / wallet hints). Does not switch RPC by itself — pair with
 * `NEXT_PUBLIC_SOLANA_RPC_URL` and `NEXT_PUBLIC_GEN2_USE_DEVNET_MINT` for devnet proof mints.
 *
 * TODO(mainnet): Set `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`, turn off `NEXT_PUBLIC_GEN2_USE_DEVNET_MINT`.
 */
export function getSolanaCluster(): string {
  return process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || 'mainnet-beta'
}

/**
 * Primary HTTP RPC for Owl Center + wallet when devnet mint mode is active; otherwise delegates to
 * `resolvePublicSolanaRpcUrl()` (dev/preview overrides preserved).
 */
export function getSolanaRpcUrl(): string {
  if (isDevnetMintEnabled()) {
    const u = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
    if (u) return sanitizeRpcUrl(u)
    return 'https://api.devnet.solana.com'
  }
  return resolvePublicSolanaRpcUrl()
}

export function isDevnetMintEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_GEN2_USE_DEVNET_MINT?.trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

function envMainnetCm(): string {
  return process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID?.trim() || ''
}

function envDevnetCm(): string {
  return process.env.NEXT_PUBLIC_GEN2_DEVNET_CANDY_MACHINE_ID?.trim() || ''
}

function envMainnetCollection(): string {
  return process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT?.trim() || ''
}

function envDevnetCollection(): string {
  return process.env.NEXT_PUBLIC_GEN2_DEVNET_COLLECTION_MINT?.trim() || ''
}

type LaunchCmFields = {
  candy_machine_id?: string | null
  collection_mint?: string | null
  devnet_candy_machine_id?: string | null
  devnet_collection_mint?: string | null
}

/**
 * Resolved Candy Machine pubkey string for the active Gen2 mint mode (env + optional DB overrides from launch row).
 */
export function getGen2CandyMachineId(launch?: LaunchCmFields | null): string {
  if (isDevnetMintEnabled()) {
    const db = launch?.devnet_candy_machine_id?.trim()
    return db || envDevnetCm()
  }
  const db = launch?.candy_machine_id?.trim()
  return db || envMainnetCm()
}

/** Collection mint for CM mintV2 collection accounts. */
export function getGen2CollectionMint(launch?: LaunchCmFields | null): string {
  if (isDevnetMintEnabled()) {
    const db = launch?.devnet_collection_mint?.trim()
    return db || envDevnetCollection()
  }
  const db = launch?.collection_mint?.trim()
  return db || envMainnetCollection()
}

export function owlMintNetworkFromParam(raw: string | undefined): OwlMintNetwork | null {
  const v = raw?.trim().toLowerCase()
  if (v === 'devnet' || v === 'mainnet') return v
  return null
}

/** JSON-RPC URL used to verify a mint transaction for Owl Center confirm route. */
export function resolveOwlCenterMintVerifyRpcUrl(network: OwlMintNetwork): string {
  if (network === 'devnet') {
    const serverDev = process.env.SOLANA_RPC_DEVNET_URL?.trim()
    if (serverDev) return sanitizeRpcUrl(serverDev)
    const pub = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
    if (pub) return sanitizeRpcUrl(pub)
    return 'https://api.devnet.solana.com'
  }
  return resolveServerSolanaRpcUrl()
}

export function owlCenterSolanaExplorerTxUrl(signature: string, network: OwlMintNetwork): string {
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`
  return network === 'devnet' ? `${base}?cluster=devnet` : base
}

/** Wallet adapter network: devnet when Gen2 devnet mint flag is on or cluster is devnet. */
export function walletAdapterShouldUseDevnet(): boolean {
  return isDevnetMintEnabled() || getSolanaCluster().toLowerCase() === 'devnet'
}
