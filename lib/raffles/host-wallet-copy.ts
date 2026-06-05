import type { Raffle } from '@/lib/types'

/** Creator wallet used for manual transfers and share copy. */
export function getRaffleHostWallet(raffle: Pick<Raffle, 'creator_wallet' | 'created_by'>): string {
  return (raffle.creator_wallet || raffle.created_by || '').trim()
}

export function buildRaffleHostWalletShareLine(raffle: Pick<Raffle, 'creator_wallet' | 'created_by'>): string | null {
  const wallet = getRaffleHostWallet(raffle)
  if (!wallet) return null
  return `Host wallet: ${wallet}`
}
