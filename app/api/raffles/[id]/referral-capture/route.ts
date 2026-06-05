import { NextRequest, NextResponse } from 'next/server'
import { lookupActiveReferralCode } from '@/lib/db/referrals'
import { normalizeReferralCodeInput } from '@/lib/referrals/code-format'
import { REFERRAL_COOKIE_NAME, REFERRAL_COOKIE_MAX_AGE_SEC } from '@/lib/referrals/constants'
import { isReferralAttributionActive, isReferralGrowthProgramActive } from '@/lib/referrals/config'
import { raffleSupportsReferralProgram } from '@/lib/referrals/program'
import { getRaffleByIdOrSlug } from '@/lib/raffles/resolve-raffle-route-param'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const CAPTURE_IP_LIMIT = 40
const CAPTURE_CODE_LIMIT = 25
const WINDOW_MS = 60_000

/**
 * GET /api/raffles/[id]/referral-capture?ref=code
 * Segment may be raffle uuid or slug. Sets httpOnly referral cookie on eligible raffles.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isReferralAttributionActive()) || !(await isReferralGrowthProgramActive())) {
      return new NextResponse(null, { status: 204 })
    }

    const { id } = await context.params
    const raffle = await getRaffleByIdOrSlug(id)
    if (!raffle || !raffleSupportsReferralProgram(raffle)) {
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

    const resolved = await lookupActiveReferralCode(code)
    if (!resolved) {
      return new NextResponse(null, { status: 204 })
    }

    const res = NextResponse.json({ ok: true, code: resolved.referralCodeUsed })
    res.cookies.set(REFERRAL_COOKIE_NAME, resolved.referralCodeUsed, {
      path: '/',
      maxAge: REFERRAL_COOKIE_MAX_AGE_SEC,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })
    return res
  } catch (e) {
    console.error('[raffles/referral-capture]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
