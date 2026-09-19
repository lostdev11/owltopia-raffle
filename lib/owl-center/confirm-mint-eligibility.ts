/**
 * Confirm-mint runs AFTER the on-chain mint already landed. Eligibility helpers prefer the
 * Candy Guard mintLimit counter, so `max_mintable` is often 0 when the wallet just filled its
 * last spot(s). Rejecting there left verified mints unrecorded and hung the "Saving your mint…"
 * recovery overlay.
 *
 * Use this gate once `verifyGen2MintTransaction` has proven an NFT was minted. Supply / wallet
 * limit enforcement for the DB write still happens inside `confirm_owl_center_gen2_mint`.
 */

export type ConfirmVerifiedMintEligibilityInput = {
  quantity: number
  maxMintable: number
  isPaused?: boolean
  /** Partner simple-mint counters (optional — Gen2 may omit). */
  walletMinted?: number | null
  walletMintLimit?: number | null
}

export type ConfirmVerifiedMintEligibilityResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Post-mint-safe quantity gate for confirm-mint routes.
 * Credits `quantity` back onto `maxMintable` so filling the last allocation can still record.
 */
export function canConfirmVerifiedMintQuantity(
  input: ConfirmVerifiedMintEligibilityInput
): ConfirmVerifiedMintEligibilityResult {
  if (input.isPaused) {
    return { ok: false, error: 'Mint temporarily paused' }
  }

  const qty = Math.floor(Number(input.quantity))
  if (!Number.isInteger(qty) || qty < 1) {
    return { ok: false, error: 'Invalid quantity' }
  }

  const maxMintable = Math.max(0, Math.floor(Number(input.maxMintable) || 0))
  // On-chain / DB counters often already include this mint — credit it back.
  const remainingIncludingThisMint = maxMintable + qty
  if (qty > remainingIncludingThisMint) {
    return { ok: false, error: 'Not eligible for this mint quantity — refresh your allocation' }
  }

  if (input.walletMinted != null && input.walletMintLimit != null) {
    const minted = Math.max(0, Math.floor(Number(input.walletMinted) || 0))
    const limit = Math.max(0, Math.floor(Number(input.walletMintLimit) || 0))
    // Post-mint count may equal the limit when they just filled their allocation.
    if (limit > 0 && minted > limit) {
      return { ok: false, error: 'Not eligible for this mint quantity — refresh your allocation' }
    }
  }

  return { ok: true }
}
