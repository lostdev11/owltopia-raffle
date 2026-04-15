import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const CACHE_TTL_MS = 45_000

export type ActivePartnerCommunityRow = {
  creator_wallet: string
  display_label: string | null
}

let cache: { rows: ActivePartnerCommunityRow[]; fetchedAt: number } | null = null

async function getSupabaseForPartnerRead(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) return null
  try {
    const { getSupabaseAdmin } = await import('@/lib/supabase-admin')
    return getSupabaseAdmin()
  } catch {
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    if (!anon) return null
    return createClient(url, anon)
  }
}

/**
 * Active partner rows (2% fee tier, spotlight). Cached briefly.
 */
export async function getActivePartnerCommunityCreatorRows(): Promise<ActivePartnerCommunityRow[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rows
  }

  const sb = await getSupabaseForPartnerRead()
  if (!sb) {
    cache = { rows: [], fetchedAt: Date.now() }
    return []
  }

  const { data, error } = await sb
    .from('partner_community_creators')
    .select('creator_wallet, display_label')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[partner-communities] fetch failed:', error.message)
    cache = { rows: [], fetchedAt: Date.now() }
    return []
  }

  const rows: ActivePartnerCommunityRow[] = (data ?? [])
    .map((r: { creator_wallet: string; display_label: string | null }) => ({
      creator_wallet: String(r.creator_wallet ?? '').trim(),
      display_label: r.display_label != null && String(r.display_label).trim() ? String(r.display_label).trim() : null,
    }))
    .filter((r) => r.creator_wallet)

  cache = { rows, fetchedAt: Date.now() }
  return rows
}

/**
 * Active partner community creator wallets (2% fee tier, spotlight).
 * Cached briefly to avoid hammering Supabase from getCreatorFeeTier / enrich loops.
 */
export async function getActivePartnerCommunityCreatorWallets(): Promise<string[]> {
  const rows = await getActivePartnerCommunityCreatorRows()
  return rows.map((r) => r.creator_wallet)
}

export async function getActivePartnerCommunityWalletSet(): Promise<Set<string>> {
  const rows = await getActivePartnerCommunityCreatorRows()
  return new Set(rows.map((r) => r.creator_wallet))
}

/** For tests or admin after mutating the table. */
export function clearPartnerCommunityWalletCache(): void {
  cache = null
}
