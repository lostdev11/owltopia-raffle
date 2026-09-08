import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isValidOwlSwapShortCode } from '@/lib/owl-swap/short-code'
import { isOwlSwapPublic } from '@/lib/owl-swap/access'
import { requireOwlSwapAccess } from '@/lib/owl-swap/require-owl-swap-access'
import {
  getOwlSwapOfferWithAssetsByCode,
  updateOwlSwapOffer,
} from '@/lib/db/owl-swap'
import { isOwlSwapSimulateSignature } from '@/lib/owl-swap/simulate'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ code: string }> }

function publicOfferView(offer: {
  id: string
  short_code: string
  maker_wallet: string
  taker_wallet: string | null
  status: string
  maker_sol_lamports: number
  taker_sol_lamports: number
  owl_fee_lamports: number | null
  fee_discount_bps: number
  expires_at: string
  created_at: string
  completed_at: string | null
  settle_sig: string | null
  maker_deposit_sig: string | null
  assets: unknown
}) {
  return {
    id: offer.id,
    short_code: offer.short_code,
    maker_wallet: offer.maker_wallet,
    taker_wallet: offer.taker_wallet,
    status: offer.status,
    maker_sol_lamports: offer.maker_sol_lamports,
    taker_sol_lamports: offer.taker_sol_lamports,
    owl_fee_lamports: offer.owl_fee_lamports,
    fee_discount_bps: offer.fee_discount_bps,
    expires_at: offer.expires_at,
    created_at: offer.created_at,
    completed_at: offer.completed_at,
    settle_sig: offer.settle_sig,
    assets: offer.assets,
    simulate: isOwlSwapSimulateSignature(offer.maker_deposit_sig),
  }
}

/** GET /api/owl-swap/offers/by-code/[code] — offer view for accept page. */
export async function GET(request: NextRequest, context: Ctx) {
  try {
    // Admin-only preview: require OwlSwap access (do not leak offers anonymously).
    if (!isOwlSwapPublic()) {
      const session = await requireOwlSwapAccess(request)
      if (session instanceof NextResponse) return session
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-swap-by-code:${ip}`, 90, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { code: rawCode } = await context.params
    const code = rawCode?.trim() ?? ''
    if (!code || !isValidOwlSwapShortCode(code)) {
      return NextResponse.json({ error: 'Invalid offer code' }, { status: 400 })
    }

    const offer = await getOwlSwapOfferWithAssetsByCode(code)
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }

    // Drafts are not shareable accept targets.
    if (offer.status === 'draft') {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }

    if (
      offer.status === 'open' &&
      new Date(offer.expires_at).getTime() < Date.now()
    ) {
      const expired = await updateOwlSwapOffer(offer.id, { status: 'expired' })
      if (expired.ok) {
        return NextResponse.json({
          offer: publicOfferView({ ...expired.row, assets: offer.assets }),
          expired: true,
        })
      }
    }

    return NextResponse.json({
      offer: publicOfferView(offer),
    })
  } catch (e) {
    console.error('owl-swap by-code GET', e)
    return NextResponse.json({ error: 'Failed to load offer' }, { status: 500 })
  }
}
