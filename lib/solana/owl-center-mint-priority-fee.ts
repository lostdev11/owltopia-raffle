/**
 * Priority fee (micro-lamports per CU) for Owl Center mint txs.
 * Default 400_000 ≈ 0.00032 SOL per mint at 800k CU; set to 0 to disable.
 *
 * Prefers `NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS`.
 * Falls back to legacy `NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS` so existing deploys keep working.
 */
export function owlCenterMintPriorityFeeMicroLamports(): number {
  const raw =
    process.env.NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS?.trim() ||
    process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS?.trim()
  if (!raw) return 400_000
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 250_000
}
