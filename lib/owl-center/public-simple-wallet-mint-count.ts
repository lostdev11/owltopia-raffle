/**
 * Partner (public_simple) per-wallet public-phase mint counting.
 *
 * Confirm always stores mint_events.phase = 'PUBLIC' (even during allowlist), while soft WL
 * consumption lives on owl_center_launch_wl_wallets.used_mints. Without subtracting allowlist
 * usage, WL mints incorrectly eat the public wallet_mint_limit (e.g. WL 2 + Public 5 → blocked at 5
 * instead of allowing 7 total).
 */

export function publicSimplePublicPhaseWalletMinted(opts: {
  /** Sum of owl_center_mint_events.quantity for phase=PUBLIC. */
  labeledPublicMinted: number
  /** Sum of owl_center_launch_wl_wallets.used_mints for this wallet (all allowlist phase keys). */
  allowlistUsedMints: number
}): number {
  const labeled = Math.max(0, Math.floor(Number(opts.labeledPublicMinted) || 0))
  const allowlistUsed = Math.max(0, Math.floor(Number(opts.allowlistUsedMints) || 0))
  return Math.max(0, labeled - allowlistUsed)
}
