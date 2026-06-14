import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'

/** Server — platform treasury for Owl Center mint fees (same as raffle treasury). */
export function getOwlCenterPlatformTreasuryWallet(): string | null {
  return getRaffleTreasuryWalletAddress()
}

/** Client — must match server `RAFFLE_RECIPIENT_WALLET`. */
export function getOwlCenterPlatformTreasuryWalletClient(): string | null {
  const w = process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET?.trim()
  return w || null
}

export function isOwlCenterPlatformMintFeeConfiguredClient(): boolean {
  return !!getOwlCenterPlatformTreasuryWalletClient()
}
