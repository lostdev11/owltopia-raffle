import type { Raffle } from '@/lib/types'

/** Creator wallet used for manual transfers and share copy. */
export function getRaffleHostWallet(raffle: Pick<Raffle, 'creator_wallet' | 'created_by'>): string {
  return (raffle.creator_wallet || raffle.created_by || '').trim()
}

/**
 * Public browse deep link filtered to a host (`/raffles?host=<wallet>`).
 * Always uses the wallet — never display name — so URLs stay unambiguous.
 */
export function buildRafflesHostBrowseHref(
  raffleOrWallet: Pick<Raffle, 'creator_wallet' | 'created_by'> | string
): string | null {
  const wallet =
    typeof raffleOrWallet === 'string' ? raffleOrWallet.trim() : getRaffleHostWallet(raffleOrWallet)
  if (!wallet) return null
  return `/raffles?host=${encodeURIComponent(wallet)}`
}

export function buildRaffleHostWalletShareLine(raffle: Pick<Raffle, 'creator_wallet' | 'created_by'>): string | null {
  const wallet = getRaffleHostWallet(raffle)
  if (!wallet) return null
  return `Host wallet: ${wallet}`
}
