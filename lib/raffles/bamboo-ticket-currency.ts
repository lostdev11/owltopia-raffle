import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const BAMBOO_TICKET_CURRENCY = 'BAMBOO' as const

/**
 * PNDA Partner Pro creator wallet. This wallet, plus platform admins, may create Bamboo-ticket raffles.
 * Buyers are not restricted; this only gates raffle creation.
 */
export const BAMBOO_TICKET_CREATOR_WALLET = 'FizjY3RFbAS9hDKXa9yVrLR4tXfftAhXSNmiR7XJmSK'

export function canWalletUseBambooTicketCurrency(wallet: string | null | undefined): boolean {
  const w = wallet?.trim()
  if (!w) return false
  return walletsEqualSolana(w, BAMBOO_TICKET_CREATOR_WALLET)
}
