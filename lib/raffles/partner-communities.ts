import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const CACHE_TTL_MS = 45_000

let cache: { wallets: string[]; fetchedAt: number } | null = null

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
 * Active partner community creator wallets (2% fee tier, spotlight).
 * Cached briefly to avoid hammering Supabase from getCreatorFeeTier / enrich loops.
 */
export async function getActivePartnerCommunityCreatorWallets(): Promise<string[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.wallets
  }

  const sb = await getSupabaseForPartnerRead()
  if (!sb) {
    cache = { wallets: [], fetchedAt: Date.now() }
    return []
  }

  const { data, error } = await sb
    .from('partner_community_creators')
    .select('creator_wallet')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[partner-communities] fetch failed:', error.message)
    cache = { wallets: [], fetchedAt: Date.now() }
    return []
  }

  const wallets = (data ?? [])
    .map((r: { creator_wallet: string }) => String(r.creator_wallet ?? '').trim())
    .filter(Boolean)

  cache = { wallets, fetchedAt: Date.now() }
  return wallets
}

export async function getActivePartnerCommunityWalletSet(): Promise<Set<string>> {
  const list = await getActivePartnerCommunityCreatorWallets()
  return new Set(list)
}

/** For tests or admin after mutating the table. */
export function clearPartnerCommunityWalletCache(): void {
  cache = null
}
