import { getRaffleById, getRaffleBySlug } from '@/lib/db/raffles'
import type { Raffle } from '@/lib/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Resolve raffle from `/api/raffles/[id]/…` where segment may be uuid or slug. */
export async function getRaffleByIdOrSlug(param: string): Promise<Raffle | null> {
  const raw = typeof param === 'string' ? param.trim() : ''
  if (!raw) return null
  if (UUID_RE.test(raw)) {
    const byId = await getRaffleById(raw)
    if (byId) return byId
  }
  const bySlug = await getRaffleBySlug(raw)
  if (bySlug) return bySlug
  if (!UUID_RE.test(raw)) {
    return getRaffleById(raw)
  }
  return null
}
