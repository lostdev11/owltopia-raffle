/**
 * Candy Machine ↔ ledger integrity helpers.
 *
 * Prevents the two sell-out mismatch modes we hit in production:
 *  A) CM fully redeemed but DB/hash-list lags (unrecorded test/orphan mints)
 *  B) Launch marked sold out / marketplace-ready while CM still has unminted slots
 *
 * On-chain CM supply is authoritative for "is the collection actually done?".
 */

import type { CandyMachineSupplySnapshot } from '@/lib/solana/candy-machine-supply'

export type CmSupplyIntegrity = {
  /** Prefer on-chain redeemed when readable so UI does not under-count orphans. */
  displayMinted: number
  displayRemaining: number
  ledgerLag: number
  /** itemsLoaded > 0 and remaining === 0 */
  cmFullyRedeemed: boolean
  /** remaining > 0 on a loaded CM */
  cmHasUnminted: boolean
  /**
   * DB/hash-list behind chain (Gen2/test-mint style), or CM still has slots while
   * the launch is being treated as sold out (partner stranded-slot style).
   */
  supplyMismatch: boolean
}

/** True whenever on-chain redeems exceed the DB ledger — phase must not gate this. */
export function shouldReconcileOrphanMints(itemsRedeemed: number, mintedCount: number): boolean {
  return Math.max(0, Math.floor(itemsRedeemed)) > Math.max(0, Math.floor(mintedCount))
}

export function isCandyMachineFullyRedeemed(
  supply: Pick<Extract<CandyMachineSupplySnapshot, { ok: true }>, 'itemsLoaded' | 'remaining'> | null | undefined
): boolean {
  if (!supply) return false
  return supply.itemsLoaded > 0 && supply.remaining === 0
}

export function computeCmSupplyIntegrity(
  totalSupply: number,
  mintedCount: number,
  supply: CandyMachineSupplySnapshot | null | undefined
): CmSupplyIntegrity {
  const total = Math.max(0, Math.floor(totalSupply))
  const minted = Math.max(0, Math.floor(mintedCount))
  const dbRemaining = Math.max(0, total - minted)

  if (!supply?.ok) {
    return {
      displayMinted: minted,
      displayRemaining: dbRemaining,
      ledgerLag: 0,
      cmFullyRedeemed: false,
      cmHasUnminted: false,
      supplyMismatch: false,
    }
  }

  const itemsRedeemed = Math.max(0, supply.itemsRedeemed)
  const onChainRemaining = Math.max(0, supply.remaining)
  const displayMinted = Math.min(total || itemsRedeemed, itemsRedeemed)
  const displayRemaining = onChainRemaining
  const ledgerLag = Math.max(0, itemsRedeemed - minted)
  const cmFullyRedeemed = isCandyMachineFullyRedeemed(supply)
  const cmHasUnminted = supply.itemsLoaded > 0 && onChainRemaining > 0

  return {
    displayMinted,
    displayRemaining,
    ledgerLag,
    cmFullyRedeemed,
    cmHasUnminted,
    supplyMismatch:
      ledgerLag > 0 ||
      minted > itemsRedeemed ||
      (cmHasUnminted && minted >= total && total > 0),
  }
}

export type SelloutMarketplaceGateInput = {
  /** Phase is SOLD_OUT / TRADING_ACTIVE or DB minted >= total. */
  dbOrPhaseSoldOut: boolean
  /** null when CM could not be read — fail closed for prep when sold-out claimed. */
  cmFullyRedeemed: boolean | null
  hashListCount: number
  /** On-chain itemsRedeemed when known; otherwise null. */
  itemsRedeemed: number | null
}

export type SelloutMarketplaceGateResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Marketplace hash-list / sell-out prep may only stamp "ready" when the CM is empty
 * and the recorded hash list covers on-chain redeems (when known).
 */
export function evaluateSelloutMarketplacePrepGate(
  input: SelloutMarketplaceGateInput
): SelloutMarketplaceGateResult {
  if (!input.dbOrPhaseSoldOut) {
    return { ok: false, reason: 'not_sold_out' }
  }
  if (input.cmFullyRedeemed === false) {
    return { ok: false, reason: 'cm_not_empty' }
  }
  if (input.cmFullyRedeemed === null) {
    return { ok: false, reason: 'cm_supply_unreadable' }
  }
  if (
    input.itemsRedeemed != null &&
    input.itemsRedeemed > 0 &&
    input.hashListCount < input.itemsRedeemed
  ) {
    return { ok: false, reason: 'hash_list_incomplete' }
  }
  return { ok: true }
}

/** Creator marketplace unlock: sold-out claim is not enough while CM still has slots. */
export function isLaunchMarketplaceListingUnlockedWithCm(
  dbOrPhaseSoldOut: boolean,
  cmFullyRedeemed: boolean | null
): boolean {
  if (!dbOrPhaseSoldOut) return false
  // If we cannot read CM, keep legacy unlock (DB/phase) so creators are not hard-blocked offline.
  if (cmFullyRedeemed === null) return true
  return cmFullyRedeemed
}
