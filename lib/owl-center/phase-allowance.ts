/**
 * Per-phase mint allowance caps (Owl Center Gen2).
 * Each phase uses its own allocation source; `wallet_mint_limit` applies to PUBLIC only.
 *
 * - AIRDROP (343 OG): 1 mint per Gen1 NFT held on the connected wallet
 * - PRESALE: paid credits + early gifted (excludes Presale+13 reserved gifts)
 * - PRESALE_OVERAGE: min(overage list slots, Presale+13 reserved gifted credits)
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
  /** Paid + presale-phase gifted credits still available. */
  presaleCreditsAvailable: number
  presalePoolRemaining: number
  supplyRemaining: number
}): number {
  return Math.min(
    Math.max(0, input.presaleCreditsAvailable),
    Math.max(0, input.presalePoolRemaining),
    Math.max(0, input.supplyRemaining)
  )
}

export function presaleOverageMaxMintable(input: {
  overageAllocationRemaining: number
  /** Presale+13 gifted credits still available on the wallet. */
  overagePhaseCreditsAvailable: number
  overagePoolRemaining: number
  supplyRemaining: number
}): number {
  return Math.min(
    Math.max(0, input.overageAllocationRemaining),
    Math.max(0, input.overagePhaseCreditsAvailable),
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

/**
 * PUBLIC phase: bounded by the per-wallet limit AND the public pool. The public pool is
 * `public_supply` plus whatever WHITELIST left unminted (WL rarely mints 100%, so its leftover
 * rolls into PUBLIC so the collection can mint out — see `gen2PublicPoolCap`). AIRDROP/PRESALE
 * leftover does NOT roll in — it stays reserved for the team's airdrop backstop. Callers pass the
 * already-rolled `publicPoolRemaining`; this is still globally capped by `supplyRemaining`.
 */
export function publicMaxMintable(input: {
  walletLimitRemaining: number
  publicPoolRemaining: number
  supplyRemaining: number
}): number {
  return Math.min(
    Math.max(0, input.walletLimitRemaining),
    Math.max(0, input.publicPoolRemaining),
    Math.max(0, input.supplyRemaining)
  )
}

