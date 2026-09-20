/** Max NFTs per Owl Center partner launch (client + server enforced). */
export const OWL_CENTER_MAX_LAUNCH_SUPPLY = 10_000

/**
 * Max per-wallet mint cap partners may set (public + allowlist phases).
 * Matches max collection supply so "unlimited" can equal one wallet minting the whole drop.
 */
export const OWL_CENTER_MAX_WALLET_MINT_LIMIT = OWL_CENTER_MAX_LAUNCH_SUPPLY

/** True when the stored per-wallet cap covers the whole collection (unlimited within supply). */
export function isOwlCenterWalletMintUnlimited(
  walletMintLimit: number | null | undefined,
  totalSupply: number | null | undefined
): boolean {
  const limit = Math.floor(Number(walletMintLimit))
  const supply = Math.floor(Number(totalSupply))
  if (!Number.isFinite(limit) || limit < 1) return false
  if (!Number.isFinite(supply) || supply < 1) return false
  return limit >= supply
}
