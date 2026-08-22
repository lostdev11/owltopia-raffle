import { validateNftMaxTickets } from '@/lib/raffles/nft-raffle-economics'
import type { Raffle } from '@/lib/types'

export const MAX_TICKETS_REQUIRED_MESSAGE =
  'Max tickets is required so buyers can see worst-case odds before entering.'

export const MAX_TICKETS_CANNOT_CLEAR_MESSAGE =
  'Max tickets cannot be cleared. Set a positive cap so buyers know worst-case odds.'

export function parseRequiredMaxTickets(
  raw: unknown
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw == null || raw === '') {
    return { ok: false, error: MAX_TICKETS_REQUIRED_MESSAGE }
  }
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: 'max_tickets must be a positive integer.' }
  }
  return { ok: true, value: parsed }
}

/** PATCH: explicit null/empty clears are rejected; omitted field is handled by caller. */
export function parseMaxTicketsUpdateInput(
  raw: unknown
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === null || raw === '') {
    return { ok: false, error: MAX_TICKETS_CANNOT_CLEAR_MESSAGE }
  }
  return parseRequiredMaxTickets(raw)
}

export function validateRequiredMaxTicketsAgainstDrawGoal(
  maxTickets: number,
  minTickets: number
): { ok: true } | { ok: false; error: string } {
  return validateNftMaxTickets(maxTickets, minTickets)
}

export function isRaffleSoldOutAtMax(
  raffle: Pick<Raffle, 'max_tickets'>,
  confirmedTickets: number
): boolean {
  if (raffle.max_tickets == null || raffle.max_tickets <= 0) return false
  return confirmedTickets >= raffle.max_tickets
}
