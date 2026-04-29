import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getOrRefreshOwlProposalEligibility } from '@/lib/council/owl-snapshot-eligibility'

export const dynamic = 'force-dynamic'

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

const IP_LIMIT = 60
const WINDOW_MS = 60_000

/**
 * GET /api/council/owl-eligibility?wallet=<address>
 * Uses DB snapshot when fresh (&lt; 7 days); otherwise one RPC refresh and upsert.
 * Public (balance is on-chain); rate-limited per IP.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`council-owl-elig:${ip}`, IP_LIMIT, WINDOW_MS)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (!wallet || !SOLANA_ADDRESS_REGEX.test(wallet)) {
      return NextResponse.json({ error: 'Valid wallet address required' }, { status: 400 })
    }

    const result = await getOrRefreshOwlProposalEligibility(wallet)

    if (!result.ok) {
      if (!result.owlConfigured) {
        return NextResponse.json({
          owlConfigured: false,
          eligible: false,
          message: result.message,
        })
      }
      return NextResponse.json(
        { error: result.message, eligible: false, owlConfigured: true },
        { status: result.code === 'invalid_wallet' ? 400 : 503 }
      )
    }

    return NextResponse.json({
      owlConfigured: true,
      eligible: result.eligible,
      checkedAt: result.checkedAt,
      refreshed: result.refreshed,
    })
  } catch (error) {
    console.error('[api/council/owl-eligibility]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
