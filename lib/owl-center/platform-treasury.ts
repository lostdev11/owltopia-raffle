import {
  getPlatformFeeTreasuryWalletAddress,
  getPlatformFeeTreasuryWalletAddressClient,
} from '@/lib/solana/platform-fee-treasury-wallet'

/** Server — platform treasury for Owl Center mint fees (launchpad platform fees). */
export function getOwlCenterPlatformTreasuryWallet(): string | null {
  return getPlatformFeeTreasuryWalletAddress()
}

/** Client — must match server `OWL_PLATFORM_FEE_TREASURY_WALLET`. */
export function getOwlCenterPlatformTreasuryWalletClient(): string | null {
  return getPlatformFeeTreasuryWalletAddressClient()
}

export function isOwlCenterPlatformMintFeeConfiguredClient(): boolean {
  return !!getOwlCenterPlatformTreasuryWalletClient()
}
