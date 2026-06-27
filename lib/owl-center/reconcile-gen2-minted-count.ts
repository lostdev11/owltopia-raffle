import { getSupabaseAdmin } from '@/lib/supabase-admin'

/**
 * Sum the `quantity` column across all mint events for a launch+network, paginating past
 * PostgREST's 1000-row default cap. Without this the sum silently saturates at 1000 once the
 * collection has more than 1000 recorded mint events.
 */
async function sumMintEventQuantity(launchId: string, network: 'mainnet' | 'devnet'): Promise<number> {
  const db = getSupabaseAdmin()
  const page = 1000
  let from = 0
  let sum = 0
  for (;;) {
    const { data, error } = await db
      .from('owl_center_mint_events')
      .select('quantity')
      .eq('launch_id', launchId)
      .eq('network', network)
      .order('created_at', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const r of rows) {
      sum += Number((r as { quantity?: number }).quantity ?? 0)
    }
    if (rows.length < page) break
    from += page
  }
  return sum
}

/**
 * Recompute a launch's `minted_count` from the authoritative recorded mint events
 * (`owl_center_mint_events`) for the given network, and self-heal the stored counter
 * if it has drifted.
 *
 * The confirm-mint RPC keeps `minted_count` in sync atomically, but the counter can
 * still drift from reality (e.g. an admin emergency override, or devnet test mints
 * inflating the mainnet counter). Calling this on the read path keeps the displayed
 * supply honest without manual DB fixes.
 *
 * Scope is intentionally the resolved mint network so production (mainnet) display is
 * never polluted by devnet test mints and vice versa.
 */
export async function reconcileLaunchMintedCount(
  launchId: string,
  network: 'mainnet' | 'devnet'
): Promise<number> {
  const db = getSupabaseAdmin()

  const [{ data: launchRow }, actual] = await Promise.all([
    db.from('owl_center_launches').select('minted_count').eq('id', launchId).maybeSingle(),
    sumMintEventQuantity(launchId, network),
  ])

  const stored = Number((launchRow as { minted_count?: number } | null)?.minted_count ?? actual)

  if (actual !== stored) {
    await db
      .from('owl_center_launches')
      .update({ minted_count: actual, updated_at: new Date().toISOString() })
      .eq('id', launchId)
  }

  return actual
}
