import {
  fetchCandyMachineOnChainSupply,
  type CandyMachineSupplySnapshot,
} from '@/lib/solana/candy-machine-supply'
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
}

/** Pure remaining math (exported for unit tests). */
export function computeEffectiveCmRemaining(
  totalSupply: number,
  mintedCount: number,
  supply: CandyMachineSupplySnapshot | null
): EffectiveCmRemaining {
  const dbRemaining = Math.max(0, totalSupply - mintedCount)
  if (!supply?.ok) {
    return {
      dbRemaining,
      onChainRemaining: null,
      remaining: dbRemaining,
      onChainSoldOut: false,
    }
  }

  const onChainRemaining = supply.remaining
  return {
    dbRemaining,
    onChainRemaining,
    remaining: Math.min(dbRemaining, onChainRemaining),
    onChainSoldOut: supply.itemsLoaded > 0 && onChainRemaining === 0 && dbRemaining > 0,
  }
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

  const supply = await fetchCandyMachineOnChainSupply(cmId, args.network)
  return computeEffectiveCmRemaining(args.totalSupply, args.mintedCount, supply)
}
