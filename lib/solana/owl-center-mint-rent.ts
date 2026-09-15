import { Connection } from '@solana/web3.js'
import { getMintSize, getTokenSize } from '@metaplex-foundation/mpl-toolbox'

import type { OwlCenterMintMode } from '@/lib/owl-center/types'
import type { OwlMintNetwork } from '@/lib/solana/network'
import { resolveServerSolanaRpcUrl, sanitizeRpcUrl } from '@/lib/solana-rpc-url'

function owlCenterMintRentRpcUrl(network: OwlMintNetwork, rpcUrl?: string): string {
  const explicit = rpcUrl?.trim()
  if (explicit) return sanitizeRpcUrl(explicit)
  if (network === 'devnet') {
    const dev =
      process.env.SOLANA_RPC_DEVNET_URL?.trim() ||
      process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim() ||
      'https://api.devnet.solana.com'
    return sanitizeRpcUrl(dev)
  }
  return resolveServerSolanaRpcUrl()
}

/** Token Metadata account data lengths (Metaplex mpl-token-metadata). */
const TM_METADATA_DATA_LEN = 679
const TM_MASTER_EDITION_DATA_LEN = 282

/**
 * Conservative Core Asset V1 data length for partner `public_simple` mints (base asset + typical plugins).
 * Account *data* length only — rent minimum is fetched live from the cluster.
 */
export const OWL_CENTER_CORE_ASSET_ACCOUNT_DATA_LEN = 512

/** Priority fee + base fee headroom per mint attempt (not rent — stays fixed). */
export const OWL_CENTER_MINT_TX_FEE_BUFFER_LAMPORTS = 5_000_000n

/**
 * @deprecated Pre–SIMD-0437 rough bundle (0.02 SOL). Used only when RPC rent lookup fails.
 * Do not use for new logic — prefer {@link getOwlCenterMintRentReservePerNftLamports}.
 */
export const OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS_FALLBACK = 20_000_000n

const rentCache = new Map<string, { atMs: number; perNftLamports: bigint }>()
const RENT_CACHE_TTL_MS = 60_000

function accountDataLengthsForMintMode(mintMode: OwlCenterMintMode): number[] {
  if (mintMode === 'public_simple') {
    return [OWL_CENTER_CORE_ASSET_ACCOUNT_DATA_LEN]
  }
  return [
    getMintSize(),
    TM_METADATA_DATA_LEN,
    TM_MASTER_EDITION_DATA_LEN,
    getTokenSize(),
  ]
}

/** Sum of live rent-exempt minimums for each new on-chain account created by one mint. */
export async function sumRentExemptMinimumLamports(
  connection: Connection,
  accountDataLengths: number[]
): Promise<bigint> {
  let total = 0n
  for (const dataLen of accountDataLengths) {
    total += BigInt(await connection.getMinimumBalanceForRentExemption(dataLen))
  }
  return total
}

/**
 * Live rent + tx-fee buffer reserved per NFT mint (tracks SIMD-0437 steps via RPC/sysvar).
 */
export async function getOwlCenterMintRentReservePerNftLamports(
  network: OwlMintNetwork,
  mintMode: OwlCenterMintMode,
  rpcUrl?: string
): Promise<bigint> {
  const cacheKey = `${network}:${mintMode}`
  const hit = rentCache.get(cacheKey)
  if (hit && Date.now() - hit.atMs < RENT_CACHE_TTL_MS) {
    return hit.perNftLamports
  }

  try {
    const conn = new Connection(owlCenterMintRentRpcUrl(network, rpcUrl), 'confirmed')
    const rentOnly = await sumRentExemptMinimumLamports(conn, accountDataLengthsForMintMode(mintMode))
    const perNft = rentOnly + OWL_CENTER_MINT_TX_FEE_BUFFER_LAMPORTS
    rentCache.set(cacheKey, { atMs: Date.now(), perNftLamports: perNft })
    return perNft
  } catch {
    return OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS_FALLBACK
  }
}

export async function getOwlCenterMintRentReserveLamports(
  network: OwlMintNetwork,
  mintMode: OwlCenterMintMode,
  quantity: number,
  rpcUrl?: string
): Promise<bigint> {
  const qty = Math.max(1, Math.floor(quantity))
  const perNft = await getOwlCenterMintRentReservePerNftLamports(network, mintMode, rpcUrl)
  return perNft * BigInt(qty)
}

/** Clear in-process rent cache (tests). */
export function clearOwlCenterMintRentCacheForTests(): void {
  rentCache.clear()
}
