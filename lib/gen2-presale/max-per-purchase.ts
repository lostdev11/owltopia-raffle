/** Max Gen2 presale spots a wallet can buy in one signed transaction (UI + public create/confirm API). */
export const GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE = 10

/**
 * Max spots we will infer from on-chain founder SOL totals (backfill, repair, reconciliation).
 * Must be high enough to match any legitimate single-signature presale payment; public UI still
 * caps at {@link GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}.
 */
export const GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE = 10_000
