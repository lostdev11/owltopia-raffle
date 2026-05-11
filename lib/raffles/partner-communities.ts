import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getSupabasePublishableKey } from '@/lib/supabase-env'

const CACHE_TTL_MS = 45_000

export type ActivePartnerCommunityRow = {
  creator_wallet: string
  display_label: string | null
}

let cache: { rows: ActivePartnerCommunityRow[]; fetchedAt: number } | null = null

function isTransientFetchFailure(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('fetch failed') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('enotfound') ||
    m.includes('econnrefused') ||
    m.includes('socket hang up')
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function getSupabaseForPartnerRead(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) return null
  try {
    const { getSupabaseAdmin } = await import('@/lib/supabase-admin')
    return getSupabaseAdmin()
  } catch {
    const anon = getSupabasePublishableKey()
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

  const attempts = 3
  let rowsRaw: { creator_wallet: string; display_label: string | null }[] | null = null
  let lastMessage: string | null = null

  for (let i = 0; i < attempts; i++) {
    const res = await sb
      .from('partner_community_creators')
      .select('creator_wallet, display_label')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (!res.error) {
      rowsRaw = (res.data ?? []) as { creator_wallet: string; display_label: string | null }[]
      break
    }

    lastMessage = res.error.message
    const retry = i < attempts - 1 && isTransientFetchFailure(res.error.message)
    if (retry) {
      await sleep(350 * (i + 1))
      continue
    }
    break
  }

  if (rowsRaw === null) {
    // Degraded: empty partners list. Avoid console.error — Next dev overlay treats it as a breaking error.
    console.warn(
      '[partner-communities] Supabase unreachable; partner spotlight tier skipped:',
      lastMessage ?? 'unknown error'
    )
    cache = { rows: [], fetchedAt: Date.now() }
    return []
  }

  const rows: ActivePartnerCommunityRow[] = rowsRaw
    .map((r) => ({
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
