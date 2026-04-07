import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import {
  applyOwlBoostIncrement,
  getCommunityGiveawayById,
  getEntryForWallet,
  isOwlBoostTxUsed,
} from '@/lib/db/community-giveaways'
import { canApplyMoreOwlBoost } from '@/lib/community-giveaways/eligibility'
import { COMMUNITY_GIVEAWAY_OWL_PER_EXTRA_ENTRY } from '@/lib/config/community-giveaways'
import { rateLimit } from '@/lib/rate-limit'
import { verifyCommunityGiveawayOwlBoostPayment } from '@/lib/solana/verify-community-giveaway-owl-boost'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/community-giveaways/[id]/owl-boost
 * Body: { signature: string } — SPL transfer of 1 OWL to raffle treasury per +1 draw weight (up to max 4).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      'unknown'
    const wallet = session.wallet.trim()
    const ipRl = rateLimit(`community-gw-boost:ip:${ip}`, 30, 60_000)
    if (!ipRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const wRl = rateLimit(`community-gw-boost:wallet:${wallet}`, 12, 60_000)
    if (!wRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
    if (!signature) {
      return NextResponse.json({ error: 'signature is required' }, { status: 400 })
    }

    const g = await getCommunityGiveawayById(id)
    if (!g) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    const entry = await getEntryForWallet(id, wallet)
    const boostOk = canApplyMoreOwlBoost(g, wallet, entry)
    if (!boostOk.ok) {
      return NextResponse.json({ error: boostOk.reason }, { status: boostOk.status ?? 400 })
    }

    const dup = await isOwlBoostTxUsed(signature)
    if (dup) {
      return NextResponse.json({ error: 'This transaction was already used for a boost' }, { status: 400 })
    }

    const verified = await verifyCommunityGiveawayOwlBoostPayment({
      signature,
      payerWallet: wallet,
      expectedUiOwl: COMMUNITY_GIVEAWAY_OWL_PER_EXTRA_ENTRY,
    })
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 400 })
    }

    const updated = await applyOwlBoostIncrement(id, wallet, signature)
    if (!updated) {
      return NextResponse.json(
        { error: 'Could not apply boost (may already be at maximum draw weight)' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, entry: updated })
  } catch (error) {
    console.error('[me/community-giveaways owl-boost]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
