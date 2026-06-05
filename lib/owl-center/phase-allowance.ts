/**
 * Per-phase mint allowance caps (Owl Center Gen2).
 * Each phase uses its own allocation source; `wallet_mint_limit` applies to PUBLIC only.
 *
 * - AIRDROP (343 OG): 1 mint per Gen1 NFT held on the connected wallet
 * - PRESALE: up to paid presale credits on the connected wallet
 * - PRESALE_OVERAGE: min(overage list slots, presale credits)
 * - WHITELIST: up to WL spots assigned in owl_center_wl_allocations
 */

export function gen1AirdropMaxMintable(input: {
  gen1NftCount: number
  mintedInPhase: number
  airdropRemainingGlobal: number
  supplyRemaining: number
}): number {
  const gen1Remaining = Math.max(0, Math.floor(input.gen1NftCount) - Math.floor(input.mintedInPhase))
  return Math.min(gen1Remaining, input.airdropRemainingGlobal, input.supplyRemaining)
}

export function presaleRedemptionMaxMintable(input: {
  purchasedCreditsAvailable: number
  presalePoolRemaining: number
  supplyRemaining: number
}): number {
  return Math.min(
    Math.max(0, input.purchasedCreditsAvailable),
    Math.max(0, input.presalePoolRemaining),
    Math.max(0, input.supplyRemaining)
  )
}

export function presaleOverageMaxMintable(input: {
  overageAllocationRemaining: number
  purchasedCreditsAvailable: number
  overagePoolRemaining: number
  supplyRemaining: number
}): number {
  return Math.min(
    Math.max(0, input.overageAllocationRemaining),
    Math.max(0, input.purchasedCreditsAvailable),
    Math.max(0, input.overagePoolRemaining),
    Math.max(0, input.supplyRemaining)
  )
}

/** WL phase: mint up to assigned WL spots minus already used. */
export function whitelistMaxMintable(input: {
  allocationRemaining: number
  wlPoolRemaining: number
  supplyRemaining: number
}): number {
  return Math.min(
    Math.max(0, input.allocationRemaining),
    Math.max(0, input.wlPoolRemaining),
    Math.max(0, input.supplyRemaining)
  )
}

/** Phases where quantity selector uses full allocation (not capped at 10). */
export function owlCenterAllowsHighQuantityMint(phase: string): boolean {
  return (
    phase === 'AIRDROP' ||
    phase === 'PRESALE' ||
    phase === 'PRESALE_OVERAGE' ||
    phase === 'WHITELIST'
  )
}
