import type { Raffle } from '@/lib/types'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { filterRafflesByPendingVisibility } from '@/lib/raffles/visibility'
import { RAFFLES_ACTIVE_ONLY_LIST_STATUSES } from '@/lib/raffles/list-query-statuses'

function supabaseBrowseListOr(): string {
  return 'list_on_platform.eq.true'
}

async function fetchViaSupabase(
  viewerWallet: string | null,
  viewerIsAdmin: boolean
): Promise<Raffle[]> {
  if (!isSupabaseConfigured()) return []
  let q = supabase
    .from('raffles')
    .select('*')
    .eq('is_active', true)
    .in('status', [...RAFFLES_ACTIVE_ONLY_LIST_STATUSES])
  if (!viewerIsAdmin) q = q.or(supabaseBrowseListOr())
  const { data, error } = await q.order('end_time', { ascending: true })
  if (error) throw new Error(error.message)
  const list = (data ?? []) as Raffle[]
  return filterRafflesByPendingVisibility(list, viewerWallet, viewerIsAdmin)
}

/**
 * Load live raffles for cart "Add live raffles". Tries GET /api/raffles?active=true, then browser Supabase.
 */
export async function fetchCartBrowseRaffles(options: {
  viewerWallet: string | null
  viewerIsAdmin: boolean
  signal?: AbortSignal
}): Promise<{ raffles: Raffle[]; error: string | null }> {
  let apiError: string | null = null

  try {
    const res = await fetch('/api/raffles?active=true', {
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal,
    })
    const data: unknown = await res.json().catch(() => null)
    if (res.ok && Array.isArray(data)) {
      return { raffles: data as Raffle[], error: null }
    }
    apiError =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : 'Could not load raffles. Try again in a moment.'
  } catch (e) {
    if (options.signal?.aborted) throw e
    apiError = 'Network error loading raffles.'
  }

  try {
    const raffles = await fetchViaSupabase(options.viewerWallet, options.viewerIsAdmin)
    if (raffles.length > 0) return { raffles, error: null }
  } catch {
    /* keep apiError */
  }

  return { raffles: [], error: apiError ?? 'Could not load raffles. Try again in a moment.' }
}
