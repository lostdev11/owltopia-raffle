import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getSupabaseForServerRead } from '@/lib/supabase-admin'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const WINDOW = 60_000

/**
 * Latest confirmed ticket rows for global "live activity" UI.
 * Public read; rate-limited. Used when Realtime WebSocket is blocked (common on some desktop networks).
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`public-live-activity:${ip}`, 45, WINDOW)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const db = getSupabaseForServerRead(supabase)
    const { data, error } = await db
      .from('entries')
      .select('id, raffle_id, wallet_address, ticket_quantity, currency, verified_at, created_at, status')
      .eq('status', 'confirmed')
      .not('verified_at', 'is', null)
      .order('verified_at', { ascending: false })
      .limit(30)

    if (error) {
      console.error('[public/live-activity]', error.message)
      return NextResponse.json({ entries: [] }, { status: 200 })
    }

    return NextResponse.json(
      { entries: data ?? [] },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (e) {
    console.error('[public/live-activity]', e)
    return NextResponse.json({ entries: [] }, { status: 200 })
  }
}
