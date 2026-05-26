import type { Raffle } from '@/lib/types'
import { formatRaffleTicketPriceSummary } from '@/lib/raffles/dual-ticket-payment'
import { formatPromoXHandleForShare } from '@/lib/raffles/promo-x-handle'
import { getSiteBaseUrl } from '@/lib/site-config'

/** Remaining time until end — best for raid / last-call posts (not total raffle length). */
export function formatRaffleRemainingDuration(endTimeIso: string, nowMs: number = Date.now()): string {
  const end = new Date(endTimeIso).getTime()
  if (!Number.isFinite(end)) return 'See raffle page'
  const remainingMs = end - nowMs
  if (remainingMs <= 0) return 'Ended'

  const totalMinutes = Math.ceil(remainingMs / 60_000)
  if (totalMinutes < 60) return 'Less than 1 hour'

  const totalHours = Math.ceil(remainingMs / 3_600_000)
  if (totalHours < 24) {
    return totalHours === 1 ? '1 hour' : `${totalHours} hours`
  }

  const totalDays = Math.ceil(remainingMs / 86_400_000)
  if (totalDays === 1) return '1 day'
  return `${totalDays} days`
}

function formatPromoLine(raffle: Raffle): string {
  const promoHandle = formatPromoXHandleForShare(raffle.promo_x_handle)
  if (promoHandle) {
    if (raffle.prize_type === 'nft') return `NFT: @${promoHandle}`
    return `Promo: @${promoHandle}`
  }

  if (raffle.prize_type === 'nft') {
    const name = raffle.nft_collection_name?.trim()
    if (name) {
      if (name.startsWith('@')) return `NFT: ${name}`
      if (/^[A-Za-z0-9_]+$/.test(name)) return `NFT: @${name}`
      return `NFT: ${name}`
    }
    const title = raffle.title.trim()
    return title ? `NFT: ${title}` : 'NFT prize'
  }

  const amt = raffle.prize_amount
  const cur = raffle.prize_currency?.trim() || 'SOL'
  if (amt != null && Number.isFinite(Number(amt))) {
    return `Prize: ${amt} ${cur}`
  }
  const title = raffle.title.trim()
  return title ? `Prize: ${title}` : 'SOL prize'
}

/** Short link for X (no scheme; matches @Owltopia_sol post style). */
export function buildOwltopiaRaffleShareShortUrl(raffle: Pick<Raffle, 'slug'>): string {
  const base = getSiteBaseUrl().replace(/^https?:\/\//, '').replace(/^www\./, '')
  const host = base.includes('owltopia') ? 'owltopia.xyz' : base
  return `${host}/raffles/${raffle.slug}`
}

function buildOwltopiaRaffleShareBody(
  raffle: Raffle,
  url: string,
  nowMs?: number
): string {
  const promoLine = formatPromoLine(raffle)
  const ticket = formatRaffleTicketPriceSummary(raffle)
  const duration = formatRaffleRemainingDuration(raffle.end_time, nowMs)

  return [
    'RAFFLE LIVE ON OWLTOPIA',
    '',
    promoLine,
    `Ticket: ${ticket}`,
    `Duration: ${duration}`,
    '',
    `Enter here: ${url}`,
  ].join('\n')
}

export function buildOwltopiaRaffleShareText(raffle: Raffle, nowMs?: number): string {
  return buildOwltopiaRaffleShareBody(raffle, buildOwltopiaRaffleShareShortUrl(raffle), nowMs)
}

export function buildOwltopiaRaffleXIntentUrl(raffle: Raffle, nowMs?: number): string {
  const text = buildOwltopiaRaffleShareText(raffle, nowMs)
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
}
