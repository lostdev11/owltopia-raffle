/**
 * Owltopia platform fee treasury — launchpad (Owl Center mint fees) and staking platform fees.
 * Separate from `RAFFLE_RECIPIENT_WALLET` (ticket sales, cancellation fees, legacy buyout, etc.).
 *
 * Server: `OWL_PLATFORM_FEE_TREASURY_WALLET`
 * Client mint builds: `NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET` (same address)
 */
export function getPlatformFeeTreasuryWalletAddress(): string | null {
  const w =
    process.env.OWL_PLATFORM_FEE_TREASURY_WALLET?.trim() ||
    process.env.NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET?.trim() ||
    ''
  return w || null
}

/** Browser / client components — must use NEXT_PUBLIC_* only. */
export function getPlatformFeeTreasuryWalletAddressClient(): string | null {
  const w = process.env.NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET?.trim()
  return w || null
}
