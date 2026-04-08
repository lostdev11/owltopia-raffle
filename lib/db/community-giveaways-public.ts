import { supabase } from '@/lib/supabase'
import { getSupabaseForServerRead } from '@/lib/supabase-admin'
import { fetchNftPreviewImageUrl } from '@/lib/solana/fetch-nft-preview-image'

/** Fields safe to expose on the public raffles page (no internal notes). Mint is public on-chain. */
export type PublicCommunityGiveaway = {
  id: string
  title: string
  description: string | null
  access_gate: 'open' | 'holder_only'
  starts_at: string
  ends_at: string | null
  nft_mint_address: string | null
  /** Resolved artwork URL (https / gateway); UI should proxy via getRaffleDisplayImageUrl. */
  prize_image_url: string | null
  /** Join rows in community_giveaway_entries (0 if table/RLS unavailable). */
  entry_count: number
}

/**
 * Count public giveaway entries per giveaway id (best-effort; supports common column names).
 */
export async function countEntriesByCommunityGiveawayIds(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {}
  const db = getSupabaseForServerRead(supabase)

  const tally = (rows: Array<Record<string, string>> | null, col: string): Record<string, number> => {
    const map: Record<string, number> = {}
    for (const row of rows || []) {
      const id = row[col]
      if (id) map[id] = (map[id] ?? 0) + 1
    }
    return map
  }

  for (const col of ['community_giveaway_id', 'giveaway_id'] as const) {
    const { data, error } = await db
      .from('community_giveaway_entries')
      .select(col)
      .in(col, ids)
    if (!error && data) {
      return tally(data as Array<Record<string, string>>, col)
    }
  }

  return {}
}

/**
 * Open community pool giveaways with prize already in escrow (ready for entries).
 * Returns [] if the table is missing or Supabase errors (e.g. project not migrated yet).
 */
export async function listPublicCommunityGiveaways(): Promise<PublicCommunityGiveaway[]> {
  try {
    const db = getSupabaseForServerRead(supabase)
    let data: unknown[] | null = null
    let error: { message?: string } | null = null

    const full = await db
      .from('community_giveaways')
      .select(
        'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_metadata_uri'
      )
      .eq('status', 'open')
      .not('prize_deposited_at', 'is', null)
      .order('starts_at', { ascending: false })

    if (full.error) {
      const msg = typeof full.error.message === 'string' ? full.error.message : String(full.error)
      if (msg.includes('nft_metadata_uri')) {
        const minimal = await db
          .from('community_giveaways')
          .select(
            'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address'
          )
          .eq('status', 'open')
          .not('prize_deposited_at', 'is', null)
          .order('starts_at', { ascending: false })
        data = minimal.data as unknown[] | null
        error = minimal.error
      } else {
        data = full.data as unknown[] | null
        error = full.error
      }
    } else {
      data = full.data as unknown[] | null
      error = full.error
    }

    if (error) {
      const msg = typeof error.message === 'string' ? error.message : String(error)
      if (
        msg.toLowerCase().includes('community_giveaways') ||
        msg.includes('does not exist') ||
        msg.includes('schema cache')
      ) {
        return []
      }
      console.error('[listPublicCommunityGiveaways]', error)
      return []
    }

    const rows = (data ?? []) as Array<{
      id: string
      title: string
      description: string | null
      access_gate: string
      starts_at: string
      ends_at: string | null
      nft_mint_address?: string | null
      nft_metadata_uri?: string | null
    }>

    const filtered = rows.filter((r) => r.access_gate === 'open' || r.access_gate === 'holder_only')
    const entryCounts = await countEntriesByCommunityGiveawayIds(filtered.map((r) => r.id))

    const withImages = await Promise.all(
      filtered.map(async (r) => {
        const prize_image_url = await fetchNftPreviewImageUrl({
          nft_mint_address: r.nft_mint_address ?? null,
          nft_metadata_uri: r.nft_metadata_uri ?? null,
        })
        return {
          id: r.id,
          title: r.title,
          description: r.description,
          access_gate: r.access_gate as 'open' | 'holder_only',
          starts_at: r.starts_at,
          ends_at: r.ends_at,
          nft_mint_address: r.nft_mint_address?.trim() || null,
          prize_image_url,
          entry_count: entryCounts[r.id] ?? 0,
        }
      })
    )

    return withImages
  } catch (e) {
    console.error('[listPublicCommunityGiveaways]', e)
    return []
  }
}
