/**
 * NFT raffles: draw threshold (min_tickets) is derived from floor price ÷ ticket price — not editable separately.
 * Creators set floor price and ticket price; the server computes min_tickets = round(floor / ticket_price).
 */

import type { Raffle } from '@/lib/types'

/** Default divisor when suggesting a starting ticket price from floor (floor ÷ this). */
export const NFT_DEFAULT_SUGGEST_TICKET_COUNT = 50

/** Reject absurd draw goals (abuse / float edge cases). */
export const NFT_DRAW_MIN_TICKETS_CAP = 1_000_000

export function parseNftFloorPrice(raw: unknown): { ok: true; value: number; string: string } | { ok: false; error: string } {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) {
    return { ok: false, error: 'Floor price is required for NFT raffles (prize value in your raffle currency).' }
  }
  const s = String(raw).trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'Floor price must be a positive number in your raffle currency.' }
  }
  if (n > 1e15) {
    return { ok: false, error: 'Floor price is too large.' }
  }
  return { ok: true, value: n, string: s }
}

/**
 * Parse a positive floor amount from stored text (display / legacy rows).
 * Unlike {@link parseNftFloorPrice}, accepts labels and punctuation, e.g. "2.5 SOL", "SOL 2.5", "1,234.5".
 */
export function lenientParseNftFloorAmount(raw: unknown): number | null {
  if (raw == null) return null
  const s = String(raw).trim().replace(/,/g, '')
  if (!s) return null
  let n = parseFloat(s)
  if (Number.isFinite(n) && n > 0 && n <= 1e15) return n
  const m = s.match(/[0-9]+(?:\.[0-9]+)?/)
  if (!m) return null
  n = parseFloat(m[0])
  if (!Number.isFinite(n) || n <= 0 || n > 1e15) return null
  return n
}

export function parseNftTicketPrice(raw: unknown): { ok: true; value: number; string: string } | { ok: false; error: string } {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) {
    return { ok: false, error: 'Ticket price is required.' }
  }
  const s = typeof raw === 'number' ? String(raw) : String(raw).trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'Ticket price must be a positive number.' }
  }
  if (n > 1e15) {
    return { ok: false, error: 'Ticket price is too large.' }
  }
  return { ok: true, value: n, string: s }
}

/** Starting ticket price hint: floor ÷ ticketGoalCount (e.g. 50 → “~50 tickets to cover floor”). */
export function suggestTicketPriceFromFloor(floor: number, ticketGoalCount: number = NFT_DEFAULT_SUGGEST_TICKET_COUNT): number {
  if (!Number.isFinite(floor) || floor <= 0 || !Number.isFinite(ticketGoalCount) || ticketGoalCount <= 0) {
    return NaN
  }
  const raw = floor / ticketGoalCount
  return Math.round(raw * 1e9) / 1e9
}

export function computeNftMinTicketsFromFloorAndTicket(floor: number, ticketPrice: number): number {
  const raw = floor / ticketPrice
  const n = Math.round(raw)
  return Math.max(1, n)
}

/**
 * Ticket-count draw threshold for eligibility and UI.
 * NFT: round(floor ÷ ticket) when parsable, but never below stored `min_tickets` when that is higher — e.g. ticket_price
 * was later normalized to floor÷50 (computed → 50) while `min_tickets` still reflects the real goal (e.g. 200).
 * Crypto: min_tickets column only.
 */
export function getEffectiveDrawThresholdTickets(raffle: Raffle): number | null {
  if ((raffle.prize_type || '').toLowerCase() !== 'nft') {
    return raffle.min_tickets ?? null
  }
  const dbMinRaw = raffle.min_tickets
  const dbMin =
    dbMinRaw != null && dbMinRaw > 0 ? Math.min(dbMinRaw, NFT_DRAW_MIN_TICKETS_CAP) : null

  const floorN = lenientParseNftFloorAmount(raffle.floor_price)
  const ticketParsed = parseNftTicketPrice(raffle.ticket_price)
  if (floorN != null && ticketParsed.ok) {
    const computed = Math.min(
      computeNftMinTicketsFromFloorAndTicket(floorN, ticketParsed.value),
      NFT_DRAW_MIN_TICKETS_CAP
    )
    if (dbMin != null) {
      return Math.max(computed, dbMin)
    }
    return computed
  }
  return dbMin
}

export function validateNftMinTicketsNotOverCap(minTickets: number): { ok: true } | { ok: false; error: string } {
  if (minTickets > NFT_DRAW_MIN_TICKETS_CAP) {
    return {
      ok: false,
      error: `Draw goal would exceed ${NFT_DRAW_MIN_TICKETS_CAP.toLocaleString()} tickets. Use a higher ticket price or lower floor price.`,
    }
  }
  return { ok: true }
}

export function validateNftMaxTickets(
  maxTickets: number | null,
  minTickets: number
): { ok: true } | { ok: false; error: string } {
  if (maxTickets == null) return { ok: true }
  if (!Number.isFinite(maxTickets) || maxTickets <= 0) {
    return { ok: false, error: 'max_tickets must be a positive number when set.' }
  }
  if (maxTickets < minTickets) {
    return {
      ok: false,
      error: `Max tickets must be at least ${minTickets} (the computed draw goal from floor ÷ ticket price), or leave empty for unlimited.`,
    }
  }
  return { ok: true }
}
