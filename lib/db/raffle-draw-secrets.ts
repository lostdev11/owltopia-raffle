import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type RaffleDrawSecretRow = {
  raffle_id: string
  seed_hex: string
  created_at: string
}

/**
 * Persist a pre-draw seed (service_role only). Never expose via public raffle selects.
 */
export async function insertRaffleDrawSecret(
  raffleId: string,
  seedHex: string
): Promise<void> {
  const seed = seedHex.trim()
  if (!raffleId.trim() || !seed) {
    throw new Error('insertRaffleDrawSecret: raffleId and seedHex required')
  }
  const { error } = await getSupabaseAdmin().from('raffle_draw_secrets').insert({
    raffle_id: raffleId.trim(),
    seed_hex: seed,
  })
  if (error) {
    throw new Error(`Failed to store draw secret: ${error.message}`)
  }
}

export async function getRaffleDrawSecret(raffleId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('raffle_draw_secrets')
    .select('seed_hex')
    .eq('raffle_id', raffleId.trim())
    .maybeSingle()
  if (error) {
    throw new Error(`Failed to load draw secret: ${error.message}`)
  }
  const seed = (data?.seed_hex as string | undefined)?.trim()
  return seed || null
}

/** Best-effort delete after reveal so the seed only lives as public draw_seed. */
export async function deleteRaffleDrawSecret(raffleId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('raffle_draw_secrets')
    .delete()
    .eq('raffle_id', raffleId.trim())
  if (error) {
    console.warn(`[raffle_draw_secrets] delete failed for ${raffleId}:`, error.message)
  }
}
