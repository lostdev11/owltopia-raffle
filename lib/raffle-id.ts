/** Supabase raffle primary keys are UUIDs */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isRaffleIdUuid(id: string): boolean {
  return UUID_RE.test(id.trim())
}
