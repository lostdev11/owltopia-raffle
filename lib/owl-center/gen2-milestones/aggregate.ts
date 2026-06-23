import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { WalletTicketRow } from '@/lib/raffles/milestones/draw'

/**
 * Sum confirmed mints per wallet for a launch, as weight rows reusable by the
 * raffle draw helpers (tickets == mint count).
 */
export async function aggregateMinterWallets(launchId: string): Promise<WalletTicketRow[]> {
  const map = new Map<string, number>()
  const pageSize = 1000
  let from = 0

  for (;;) {
    const { data, error } = await getSupabaseAdmin()
      .from('owl_center_mint_events')
      .select('wallet_address,quantity')
      .eq('launch_id', launchId)
      .range(from, from + pageSize - 1)

    if (error) {
      console.error('[gen2-milestones] aggregateMinterWallets:', error.message)
      break
    }
    const rows = data ?? []
    for (const r of rows) {
      const row = r as Record<string, unknown>
      const w = String(row.wallet_address ?? '').trim()
      const qty = Math.max(0, Math.floor(Number(row.quantity ?? 0)))
      if (!w || qty <= 0) continue
      map.set(w, (map.get(w) ?? 0) + qty)
    }
    if (rows.length < pageSize) break
    from += pageSize
  }

  return Array.from(map.entries())
    .map(([wallet, tickets]) => ({ wallet, tickets }))
    .filter((r) => r.tickets > 0)
}
