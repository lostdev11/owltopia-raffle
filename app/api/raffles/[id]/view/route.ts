import { NextRequest, NextResponse } from 'next/server'
import { lookupActiveReferralCode } from '@/lib/db/referrals'
import { recordRaffleView } from '@/lib/db/raffle-views'
import { REFERRAL_COOKIE_NAME } from '@/lib/referrals/constants'
import { isReferralGrowthProgramActive } from '@/lib/referrals/config'
import { raffleSupportsReferralProgram } from '@/lib/referrals/program'
import { getRaffleByIdOrSlug } from '@/lib/raffles/resolve-raffle-route-param'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeReferralCodeInput } from '@/lib/referrals/code-format'

export const dynamic = 'force-dynamic'

const IP_LIMIT = 60
const WINDOW_MS = 60_000

/**
 * POST /api/raffles/[id]/view
 * Segment may be raffle uuid or slug. Records a deduped page view.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isReferralGrowthProgramActive())) {
      return NextResponse.json({ ok: true, recorded: false })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`raffle-view:${ip}`, IP_LIMIT, WINDOW_MS)
    if (!rl.allowed) {
      return NextResponse.json({ ok: true, recorded: false })
    }

    const { id } = await context.params
    const raffle = await getRaffleByIdOrSlug(id)
    if (!raffle) {
      return NextResponse.json({ ok: false }, { status: 404 })
    }

    let body: { sessionId?: string; viewerWallet?: string } = {}
    try {
      body = (await request.json()) as typeof body
    } catch {
      body = {}
    }

    let referralCodeUsed: string | null = null
    let referrerWallet: string | null = null
    const cookieRaw = request.cookies.get(REFERRAL_COOKIE_NAME)?.value?.trim()
    const codeFromCookie = normalizeReferralCodeInput(cookieRaw ?? '')
    if (codeFromCookie && raffleSupportsReferralProgram(raffle)) {
      const resolved = await lookupActiveReferralCode(codeFromCookie)
      if (resolved) {
        referralCodeUsed = resolved.referralCodeUsed
        referrerWallet = resolved.referrerWallet
      }
    }

    const recorded = await recordRaffleView({
      raffleId: raffle.id,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      viewerWallet: typeof body.viewerWallet === 'string' ? body.viewerWallet : null,
      referrerWallet,
      referralCodeUsed,
      userAgent: request.headers.get('user-agent'),
      ip,
    })

    return NextResponse.json({ ok: true, recorded })
  } catch (e) {
    console.error('[raffles/view]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: true, recorded: false })
  }
}
