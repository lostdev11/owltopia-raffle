import { getDiscordMarketplaceEscrowPublicKey } from '@/lib/solana/discord-marketplace-escrow'
import {
  marketplaceEscrowHoldsNft,
  marketplaceEscrowHoldsOwl,
  payoutNftFromMarketplaceEscrow,
  payoutOwlFromMarketplaceEscrow,
} from '@/lib/solana/discord-marketplace-escrow'

export function getDiscordMarketplaceNftEscrowAddress(): string | null {
  return getDiscordMarketplaceEscrowPublicKey()
}

export async function verifyNftDepositedInMarketplaceEscrow(nftMint: string): Promise<{
  ok: boolean
  error?: string
}> {
  const hold = await marketplaceEscrowHoldsNft(nftMint)
  if (!hold.ok) {
    return {
      ok: false,
      error: hold.error ?? 'NFT not found in marketplace escrow. Transfer it to the marketplace wallet first.',
    }
  }
  return { ok: true }
}

export async function verifyOwlDepositedInMarketplaceEscrow(amountUi: number): Promise<{
  ok: boolean
  error?: string
}> {
  const hold = await marketplaceEscrowHoldsOwl(amountUi)
  if (!hold.ok) {
    return { ok: false, error: hold.error }
  }
  return { ok: true }
}

export async function fulfillMarketplaceNftToBuyer(params: {
  nftMint: string
  recipientWallet: string
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  return payoutNftFromMarketplaceEscrow(params.nftMint, params.recipientWallet)
}

export async function fulfillMarketplaceOwlFromEscrow(params: {
  recipientWallet: string
  owlAmountUi: number
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  return payoutOwlFromMarketplaceEscrow(params.recipientWallet, params.owlAmountUi)
}
