/** Max presale credits (purchased + gifted) per wallet. Enforced in DB + public APIs. */
export const GEN2_PRESALE_MAX_CREDITS_PER_WALLET = 20

/** Max Gen2 presale spots a wallet can buy in one signed transaction (UI + public create/confirm API). */
export const GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE = GEN2_PRESALE_MAX_CREDITS_PER_WALLET

/**
 * Max spots we will infer from on-chain founder SOL totals (backfill, repair, reconciliation).
 * Must be high enough to match any legitimate single-signature presale payment; public UI still
 * caps at {@link GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}.
 */
export const GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE = 10_000

export function gen2PresaleTotalCreditsOnWallet(
  b: Pick<{ purchased_mints: number; gifted_mints: number }, 'purchased_mints' | 'gifted_mints'> | null
): number {
  if (!b) return 0
  const p = Number(b.purchased_mints)
  const g = Number(b.gifted_mints)
  const pi = Number.isFinite(p) ? Math.floor(p) : 0
  const gi = Number.isFinite(g) ? Math.floor(g) : 0
  return Math.max(0, pi + gi)
}

/** Remaining presale credits this wallet may receive (purchases + gifts). */
export function gen2PresaleCreditsRemainingForWallet(
  b: Pick<{ purchased_mints: number; gifted_mints: number }, 'purchased_mints' | 'gifted_mints'> | null
): number {
  return Math.max(0, GEN2_PRESALE_MAX_CREDITS_PER_WALLET - gen2PresaleTotalCreditsOnWallet(b))
}
