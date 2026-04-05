/**
 * NFT raffles: fixed draw goal (min tickets) and ticket price derived only from floor price.
 * Prevents creators from decoupling displayed prize value from ticket economics.
 */

export const NFT_RAFFLE_MIN_TICKETS = 50

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

/** Ticket price stored with up to 9 decimal places so min_tickets × price ≈ floor for typical values. */
export function computeNftTicketPriceFromFloor(floor: number): number {
  const raw = floor / NFT_RAFFLE_MIN_TICKETS
  return Math.round(raw * 1e9) / 1e9
}

export function validateNftMaxTickets(maxTickets: number | null): { ok: true } | { ok: false; error: string } {
  if (maxTickets == null) return { ok: true }
  if (!Number.isFinite(maxTickets) || maxTickets <= 0) {
    return { ok: false, error: 'max_tickets must be a positive number when set.' }
  }
  if (maxTickets < NFT_RAFFLE_MIN_TICKETS) {
    return {
      ok: false,
      error: `Max tickets must be at least ${NFT_RAFFLE_MIN_TICKETS} (the fixed draw goal), or leave empty for unlimited.`,
    }
  }
  return { ok: true }
}
