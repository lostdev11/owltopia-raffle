/**
 * Per-NFT SOL budget for Owl Center mint (platform fee + rent buffer + candy-guard price).
 * Batch mint cost is this unit × quantity — eligibility/UI must scale the same way as the mint path.
 */

export function owlCenterMintSolNeededPerNftLamports(params: {
  platformFeeLamports?: bigint | null
  rentReservePerNftLamports: bigint
  mintPriceLamportsPerNft?: bigint | null
}): bigint {
  const fee = params.platformFeeLamports != null && params.platformFeeLamports > 0n ? params.platformFeeLamports : 0n
  const price =
    params.mintPriceLamportsPerNft != null && params.mintPriceLamportsPerNft > 0n
      ? params.mintPriceLamportsPerNft
      : 0n
  return fee + params.rentReservePerNftLamports + price
}

/** How many NFTs the wallet can fund at the per-NFT SOL budget (0 if underfunded for one). */
export function affordableOwlCenterMintQuantity(
  walletBalanceLamports: bigint | null | undefined,
  perNftNeededLamports: bigint
): number | null {
  if (walletBalanceLamports == null || perNftNeededLamports <= 0n) return null
  if (walletBalanceLamports < perNftNeededLamports) return 0
  const q = walletBalanceLamports / perNftNeededLamports
  const n = Number(q)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), 1_000_000)
}

export function scaleOwlCenterMintSolNeededLamports(
  perNftNeededLamports: bigint | string | null | undefined,
  quantity: number
): bigint | null {
  if (perNftNeededLamports == null) return null
  const unit =
    typeof perNftNeededLamports === 'bigint' ? perNftNeededLamports : BigInt(perNftNeededLamports)
  if (unit < 0n) return null
  const qty = Math.max(1, Math.floor(quantity))
  return unit * BigInt(qty)
}

/**
 * Cap allocation-based max_mintable by wallet SOL so batch qty cannot exceed what the mint path
 * will accept (fee × N + price × N + rent × N).
 */
export function capMintableByOwlCenterSolBudget(params: {
  maxMintable: number
  isEligible: boolean
  reason: string | null
  walletBalanceLamports: bigint | null | undefined
  perNftNeededLamports: bigint
}): { maxMintable: number; isEligible: boolean; reason: string | null } {
  const allocationMax = Math.max(0, Math.floor(params.maxMintable))
  if (!params.isEligible || allocationMax <= 0 || params.perNftNeededLamports <= 0n) {
    return {
      maxMintable: allocationMax,
      isEligible: params.isEligible,
      reason: params.reason,
    }
  }

  const affordable = affordableOwlCenterMintQuantity(
    params.walletBalanceLamports,
    params.perNftNeededLamports
  )
  if (affordable == null) {
    return {
      maxMintable: allocationMax,
      isEligible: params.isEligible,
      reason: params.reason,
    }
  }

  if (affordable <= 0) {
    const needSol = Number(params.perNftNeededLamports) / 1_000_000_000
    const haveSol =
      params.walletBalanceLamports != null ? Number(params.walletBalanceLamports) / 1_000_000_000 : 0
    return {
      maxMintable: 0,
      isEligible: false,
      reason: `Need ~${needSol.toFixed(3)} SOL for mint price, platform fee, and rent (your wallet has ~${haveSol.toFixed(3)} SOL).`,
    }
  }

  const capped = Math.min(allocationMax, affordable)
  if (capped < allocationMax) {
    const base = params.reason?.trim()
    const note = `up to ${capped} mint${capped === 1 ? '' : 's'} (SOL balance limits batch size)`
    const rewritten = base?.replace(/up to \d+ mints?/i, note) ?? null
    return {
      maxMintable: capped,
      isEligible: true,
      reason: rewritten && rewritten !== base ? rewritten : base ? `${base} · ${note}` : `Eligible · ${note}`,
    }
  }

  return {
    maxMintable: capped,
    isEligible: true,
    reason: params.reason,
  }
}
