import { NextRequest, NextResponse } from 'next/server'
import { normalizeReferralCodeInput } from '@/lib/referrals/code-format'
import { REFERRAL_COOKIE_NAME, REFERRAL_COOKIE_MAX_AGE_SEC } from '@/lib/referrals/constants'
import { isReferralAttributionEnabled } from '@/lib/referrals/config'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const CAPTURE_IP_LIMIT = 40
const CAPTURE_CODE_LIMIT = 25
const WINDOW_MS = 60_000

/**
 * GET /api/referrals/capture?ref=code
 * Validates `ref`, then sets an httpOnly cookie so checkout can attribute without exposing the code to page JS.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isReferralAttributionEnabled()) {
      return new NextResponse(null, { status: 204 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`referral-capture:${ip}`, CAPTURE_IP_LIMIT, WINDOW_MS)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const ref = request.nextUrl.searchParams.get('ref')
    const code = normalizeReferralCodeInput(ref ?? '')
    if (!code) {
      return new NextResponse(null, { status: 204 })
    }

    const codeRl = rateLimit(`referral-capture:code:${code}`, CAPTURE_CODE_LIMIT, WINDOW_MS)
    if (!codeRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.set(REFERRAL_COOKIE_NAME, code, {
      path: '/',
      maxAge: REFERRAL_COOKIE_MAX_AGE_SEC,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })
    return res
  } catch (e) {
    console.error('[referrals/capture]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
