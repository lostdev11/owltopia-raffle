/**
 * Optional raffle-level cap on confirmed tickets held by a single wallet.
 * NULL / unset = unlimited per wallet (same semantics as max_tickets).
 */

export function validateMaxTicketsPerWallet(
  maxPerWallet: number | null | undefined,
  maxTickets: number | null | undefined
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (maxPerWallet == null || maxPerWallet === undefined) {
    return { ok: true, value: null }
  }
  if (!Number.isFinite(maxPerWallet) || !Number.isInteger(maxPerWallet) || maxPerWallet <= 0) {
    return { ok: false, error: 'max_tickets_per_wallet must be a positive integer when set.' }
  }
  if (maxTickets != null && Number.isFinite(maxTickets) && maxPerWallet > maxTickets) {
    return {
      ok: false,
      error: 'Max tickets per wallet cannot exceed the raffle max tickets.',
    }
  }
  return { ok: true, value: maxPerWallet }
}

/** Parse create/PATCH body field; empty string / null → null (unlimited). */
export function parseMaxTicketsPerWalletInput(
  raw: unknown
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, value: null }
  }
  if (raw === null || raw === '') {
    return { ok: true, value: null }
  }
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: 'max_tickets_per_wallet must be a positive integer when set.' }
  }
  return { ok: true, value: parsed }
}
