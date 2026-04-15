import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { referralMaxBuyerRows24h, referralMaxReferrerRows24h } from '@/lib/referrals/hardening'

const WINDOW_HOURS = 24

function sinceIso(): string {
  return new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()
}

/**
 * Blocks obvious spray: too many referred checkouts from one buyer or to one referrer in 24h.
 * Counts pending + confirmed rows with a referrer (excludes rejected).
 */
export async function referralAbuseAllowsNewRow(
  buyerWallet: string,
  referrerWallet: string
): Promise<boolean> {
  const buyer = buyerWallet.trim()
  const referrer = referrerWallet.trim()
  if (!buyer || !referrer) return false

  const admin = getSupabaseAdmin()
  const since = sinceIso()
  const buyerMax = referralMaxBuyerRows24h()
  const refMax = referralMaxReferrerRows24h()

  const { count: buyerCount, error: e1 } = await admin
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('wallet_address', buyer)
    .not('referrer_wallet', 'is', null)
    .in('status', ['pending', 'confirmed'])
    .gte('created_at', since)

  if (e1) {
    console.error('[referral-abuse] buyer count:', e1.message)
    return false
  }

  const { count: refCount, error: e2 } = await admin
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('referrer_wallet', referrer)
    .in('status', ['pending', 'confirmed'])
    .gte('created_at', since)

  if (e2) {
    console.error('[referral-abuse] referrer count:', e2.message)
    return false
  }

  if ((buyerCount ?? 0) >= buyerMax) return false
  if ((refCount ?? 0) >= refMax) return false
  return true
}
