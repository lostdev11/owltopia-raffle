import {
  computeCmSupplyIntegrity,
  type CmSupplyIntegrity,
} from '@/lib/owl-center/cm-supply-integrity'
import type { CandyMachineSupplySnapshot } from '@/lib/solana/candy-machine-supply'
import type { OwlMintNetwork } from '@/lib/solana/network'

export type EffectiveCmRemaining = {
  dbRemaining: number
  onChainRemaining: number | null
  /** min(DB, on-chain) when CM supply is readable; otherwise DB. */
  remaining: number
  /**
   * Candy Machine is empty (itemsLoaded > 0, remaining 0) while the DB ledger still
   * shows leftovers — UI must treat this as sold out even if `minted_count` lags.
   */
  onChainSoldOut: boolean
  /** Prefer on-chain redeemed so progress never under-counts orphan/test mints. */
  displayMinted: number
  /** itemsRedeemed - minted_count when chain is ahead of the ledger. */
  ledgerLag: number
  /** CM loaded and remaining === 0. */
  cmFullyRedeemed: boolean
  /** CM still has unminted config lines. */
  cmHasUnminted: boolean
  supplyMismatch: boolean
}

function withIntegrity(
  totalSupply: number,
  mintedCount: number,
  base: Omit<
    EffectiveCmRemaining,
    'displayMinted' | 'ledgerLag' | 'cmFullyRedeemed' | 'cmHasUnminted' | 'supplyMismatch'
  >,
  supply: CandyMachineSupplySnapshot | null
): EffectiveCmRemaining {
  const integrity: CmSupplyIntegrity = computeCmSupplyIntegrity(totalSupply, mintedCount, supply)
  return {
    ...base,
    displayMinted: integrity.displayMinted,
    ledgerLag: integrity.ledgerLag,
    cmFullyRedeemed: integrity.cmFullyRedeemed,
    cmHasUnminted: integrity.cmHasUnminted,
    supplyMismatch: integrity.supplyMismatch,
  }
}

/** Pure remaining math (exported for unit tests). */
export function computeEffectiveCmRemaining(
  totalSupply: number,
  mintedCount: number,
  supply: CandyMachineSupplySnapshot | null
): EffectiveCmRemaining {
  const dbRemaining = Math.max(0, totalSupply - mintedCount)
  if (!supply?.ok) {
    return withIntegrity(
      totalSupply,
      mintedCount,
      {
        dbRemaining,
        onChainRemaining: null,
        remaining: dbRemaining,
        onChainSoldOut: false,
      },
      supply
    )
  }

  const onChainRemaining = supply.remaining
  return withIntegrity(
    totalSupply,
    mintedCount,
    {
      dbRemaining,
      onChainRemaining,
      remaining: Math.min(dbRemaining, onChainRemaining),
      onChainSoldOut: supply.itemsLoaded > 0 && onChainRemaining === 0 && dbRemaining > 0,
    },
    supply
  )
}

/**
 * Cap displayed / mintable remaining by live Candy Machine supply so a DB ledger
 * lag (or total_supply > itemsLoaded) cannot advertise leftovers that cannot mint.
 */
export async function resolveEffectiveCmRemaining(args: {
  totalSupply: number
  mintedCount: number
  candyMachineId: string | null | undefined
  network: OwlMintNetwork
}): Promise<EffectiveCmRemaining> {
  const cmId = args.candyMachineId?.trim()
  if (!cmId) {
    return computeEffectiveCmRemaining(args.totalSupply, args.mintedCount, null)
  }

  // Lazy import keeps pure unit tests free of Solana/umi runtime deps.
  const { fetchCandyMachineOnChainSupply } = await import('@/lib/solana/candy-machine-supply')
  const supply = await fetchCandyMachineOnChainSupply(cmId, args.network)
  return computeEffectiveCmRemaining(args.totalSupply, args.mintedCount, supply)
}
