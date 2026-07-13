import { PublicKey } from '@solana/web3.js'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'

/** Receives SOL / OWL on-chain payments for marketplace NFT and OWL listings (separate from inventory escrow). */
export function getDiscordMarketplacePaymentWalletAddress(): string | null {
  const dedicated = process.env.DISCORD_MARKETPLACE_PAYMENT_WALLET?.trim()
  if (dedicated) return dedicated
  return getRaffleTreasuryWalletAddress()
}

export function getDiscordMarketplacePaymentWalletPubkey(): PublicKey | null {
  const w = getDiscordMarketplacePaymentWalletAddress()
  if (!w) return null
  try {
    return new PublicKey(w)
  } catch {
    return null
  }
}
