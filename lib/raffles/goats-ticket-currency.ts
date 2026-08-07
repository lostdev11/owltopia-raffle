import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const GOATS_TICKET_CURRENCY = 'GOATS' as const

/** GOATS OF SOLANA mainnet mint (Partner Pro ticket + prize token). */
export const GOATS_MINT_MAINNET = 'BBLpindmy8n5ACcYyQmwsZbsT651g9u7C8TdKcgFBAGS'

/**
 * Goats of Solana Partner Pro creator wallet (paid $100 setup).
 * This wallet, plus platform admins, may create GOATS-ticket raffles.
 * Buyers are not restricted; this only gates raffle creation.
 */
export const GOATS_TICKET_CREATOR_WALLET = 'BwfWJ1NxX5vBifv4bz7EoNMgQinMCbR33s9nPfnGVQdu'

export function canWalletUseGoatsTicketCurrency(wallet: string | null | undefined): boolean {
  const w = wallet?.trim()
  if (!w) return false
  return walletsEqualSolana(w, GOATS_TICKET_CREATOR_WALLET)
}
