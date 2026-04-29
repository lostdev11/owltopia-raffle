import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { parseOr400, referralVanityBody } from '@/lib/validations'
import { setVanityReferralCode } from '@/lib/db/referrals'
import { REFERRAL_CODE_MAX_LEN } from '@/lib/referrals/code-format'

export const dynamic = 'force-dynamic'

const IP_LIMIT = 20
const WALLET_LIMIT = 8
const WINDOW_MS = 60_000

/**
 * POST /api/me/referral/vanity
 * Body: { slug }. Owltopia holders only; retires previous active code (never reused).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`referral-vanity:ip:${ip}`, IP_LIMIT, WINDOW_MS)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const walletRl = rateLimit(`referral-vanity:wallet:${session.wallet}`, WALLET_LIMIT, WINDOW_MS)
    if (!walletRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = parseOr400(referralVanityBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const slug = parsed.data.slug.trim().slice(0, REFERRAL_CODE_MAX_LEN)
    const result = await setVanityReferralCode(session.wallet, slug)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true, activeCode: result.activeCode })
  } catch (e) {
    console.error('[referral/vanity]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
