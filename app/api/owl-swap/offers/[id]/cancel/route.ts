import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { requireOwlSwapAccess } from '@/lib/owl-swap/require-owl-swap-access'
import {
  getOwlSwapOfferWithAssetsById,
  updateOwlSwapOffer,
} from '@/lib/db/owl-swap'
import { sendOwlSwapCancelReclaimTransaction } from '@/lib/owl-swap/escrow'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

type Ctx = { params: Promise<{ id: string }> }

function requireConnectedMatchesSession(
  request: NextRequest,
  sessionWallet: string
): NextResponse | null {
  const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
  if (!connected || connected !== sessionWallet) {
    return NextResponse.json(
      { error: 'Connected wallet does not match session. Sign in with this wallet.' },
      { status: 401 }
    )
  }
  return null
}

/** POST /api/owl-swap/offers/[id]/cancel — maker cancel draft/open; reclaim if open. */
export async function POST(request: NextRequest, context: Ctx) {
  try {
    const session = await requireOwlSwapAccess(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const { id } = await context.params
    if (!id?.trim()) {
      return NextResponse.json({ error: 'Offer id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-swap-cancel:${ip}:${session.wallet}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const offer = await getOwlSwapOfferWithAssetsById(id.trim())
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }
    if (offer.maker_wallet !== session.wallet) {
      return NextResponse.json({ error: 'Only the maker can cancel.' }, { status: 403 })
    }
    if (offer.status !== 'draft' && offer.status !== 'open') {
      return NextResponse.json(
        { error: `Offer is ${offer.status}; cannot cancel.` },
        { status: 400 }
      )
    }

    let reclaimSig: string | null = null
    if (offer.status === 'open') {
      const makerAssets = offer.assets.filter((a) => a.side === 'maker')
      const reclaim = await sendOwlSwapCancelReclaimTransaction({
        makerWallet: offer.maker_wallet,
        mints: makerAssets.map((a) => a.mint),
        solLamports: offer.maker_sol_lamports,
      })
      if (!reclaim.ok) {
        return NextResponse.json({ error: reclaim.error }, { status: 500 })
      }
      reclaimSig = reclaim.signature || null
    }

    const updated = await updateOwlSwapOffer(offer.id, { status: 'cancelled' })
    if (!updated.ok) {
      return NextResponse.json({ error: updated.error }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      offer: updated.row,
      reclaimSig,
    })
  } catch (e) {
    console.error('owl-swap cancel', e)
    return NextResponse.json({ error: 'Failed to cancel offer' }, { status: 500 })
  }
}
