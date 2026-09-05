/**
 * Read Core Candy Guard per-wallet mintLimit counter (tamper-proof).
 * Used to block a second mint attempt before the user pays platform fee + bot tax.
 */
import { isSome, publicKey, type PublicKey as UmiPublicKey, type Umi } from '@metaplex-foundation/umi'
import type { DefaultGuardSet } from '@metaplex-foundation/mpl-core-candy-machine'

import { safeFetchMintCounterFromSeeds } from '@/lib/solana/core-candy-machine'

export function coreGuardMintLimitId(guards: DefaultGuardSet | null | undefined): number | null {
  if (!guards || !isSome(guards.mintLimit)) return null
  return Number(guards.mintLimit.value.id)
}

export function coreGuardMintLimitCap(guards: DefaultGuardSet | null | undefined): number | null {
  if (!guards || !isSome(guards.mintLimit)) return null
  return Number(guards.mintLimit.value.limit)
}

/**
 * On-chain count for this wallet + mintLimit id (0 when the counter PDA does not exist yet).
 */
export async function fetchCoreWalletMintLimitCount(params: {
  umi: Pick<Umi, 'eddsa' | 'programs' | 'rpc'>
  mintLimitId: number
  wallet: string
  candyGuard: UmiPublicKey | string
  candyMachine: UmiPublicKey | string
}): Promise<number> {
  const counter = await safeFetchMintCounterFromSeeds(params.umi, {
    id: params.mintLimitId,
    user: publicKey(params.wallet),
    candyGuard: publicKey(params.candyGuard),
    candyMachine: publicKey(params.candyMachine),
  })
  return counter ? Number(counter.count) : 0
}

/**
 * Fail closed before building a mint tx when the wallet has already used its on-chain mintLimit.
 */
export async function assertCoreWalletMintLimitRemaining(params: {
  umi: Pick<Umi, 'eddsa' | 'programs' | 'rpc'>
  guards: DefaultGuardSet | null | undefined
  wallet: string
  candyGuard: UmiPublicKey | string
  candyMachine: UmiPublicKey | string
  quantity: number
}): Promise<{ ok: true; minted: number; limit: number } | { ok: false; error: string }> {
  const limit = coreGuardMintLimitCap(params.guards)
  const id = coreGuardMintLimitId(params.guards)
  if (limit == null || id == null) return { ok: true, minted: 0, limit: Number.POSITIVE_INFINITY }

  let minted = 0
  try {
    minted = await fetchCoreWalletMintLimitCount({
      umi: params.umi,
      mintLimitId: id,
      wallet: params.wallet,
      candyGuard: params.candyGuard,
      candyMachine: params.candyMachine,
    })
  } catch {
    // Fail open on RPC read errors — simulation + on-chain mintLimit still enforce.
    return { ok: true, minted: 0, limit }
  }

  const remaining = Math.max(0, limit - minted)
  if (remaining <= 0) {
    return {
      ok: false,
      error: `Wallet mint limit reached (${limit} per wallet on-chain). Minting again would only charge fees — no NFT.`,
    }
  }
  if (params.quantity > remaining) {
    return {
      ok: false,
      error: `Only ${remaining} mint${remaining === 1 ? '' : 's'} left for this wallet (limit ${limit}).`,
    }
  }
  return { ok: true, minted, limit }
}
