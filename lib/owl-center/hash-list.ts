import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** Collect unique minted NFT addresses from owl_center_mint_events for a launch. */
export async function collectMintedNftMintsForLaunch(launchId: string): Promise<string[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_mint_events')
    .select('minted_nft_mints')
    .eq('launch_id', launchId)
    .order('created_at', { ascending: true })

  if (error || !data) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const row of data) {
    const list = (row as { minted_nft_mints?: string[] | null }).minted_nft_mints
    if (!Array.isArray(list)) continue
    for (const m of list) {
      const t = String(m ?? '').trim()
      if (t && !seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
  }
  return out
}
