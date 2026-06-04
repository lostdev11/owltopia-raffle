import { createHash } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const VIEW_DEDUPE_MS = 30 * 60 * 1000

function hashIp(ip: string): string {
  const salt = process.env.REFERRAL_VIEW_IP_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'owl-views'
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex')
}

export async function recordRaffleView(params: {
  raffleId: string
  sessionId: string | null
  viewerWallet: string | null
  referrerWallet: string | null
  referralCodeUsed: string | null
  userAgent: string | null
  ip: string | null
}): Promise<boolean> {
  const db = getSupabaseAdmin()
  const sessionId = params.sessionId?.trim() || null

  if (sessionId) {
    const since = new Date(Date.now() - VIEW_DEDUPE_MS).toISOString()
    const { data: recent } = await db
      .from('raffle_views')
      .select('id')
      .eq('raffle_id', params.raffleId)
      .eq('session_id', sessionId)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle()
    if (recent?.id) return false
  }

  const { error } = await db.from('raffle_views').insert({
    raffle_id: params.raffleId,
    session_id: sessionId,
    viewer_wallet: params.viewerWallet?.trim() || null,
    referrer_wallet: params.referrerWallet?.trim() || null,
    referral_code_used: params.referralCodeUsed?.trim() || null,
    user_agent: params.userAgent?.trim()?.slice(0, 512) || null,
    ip_hash: params.ip ? hashIp(params.ip) : null,
  })

  if (error) {
    console.error('[raffle-views] insert:', error.message)
    return false
  }
  return true
}

export async function countRaffleViews(raffleId: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('raffle_views')
    .select('id', { count: 'exact', head: true })
    .eq('raffle_id', raffleId)

  if (error) {
    console.error('[raffle-views] count:', error.message)
    return 0
  }
  return count ?? 0
}
