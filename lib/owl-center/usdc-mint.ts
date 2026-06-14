import type { OwlMintNetwork } from '@/lib/solana/network'
import { getTokenInfo } from '@/lib/tokens'

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** Circle devnet USDC — override with NEXT_PUBLIC_USDC_MINT_DEVNET if needed. */
const USDC_DEVNET_DEFAULT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

export function usdcMintForOwlCenterNetwork(network: OwlMintNetwork): string | null {
  if (network === 'mainnet') {
    return getTokenInfo('USDC').mintAddress ?? USDC_MAINNET
  }
  return process.env.NEXT_PUBLIC_USDC_MINT_DEVNET?.trim() || USDC_DEVNET_DEFAULT
}
