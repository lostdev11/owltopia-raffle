import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isValidOwlSwapShortCode } from '@/lib/owl-swap/short-code'
import {
  getOwlSwapOfferWithAssetsByCode,
  updateOwlSwapOffer,
} from '@/lib/db/owl-swap'
import { isOwlSwapSimulateSignature } from '@/lib/owl-swap/simulate'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ code: string }> }

/** GET /api/owl-swap/offers/by-code/[code] — public offer view for accept page. */
export async function GET(request: NextRequest, context: Ctx) {
  try {
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

    if (
      (offer.status === 'open' || offer.status === 'draft') &&
      new Date(offer.expires_at).getTime() < Date.now()
    ) {
      const expired = await updateOwlSwapOffer(offer.id, { status: 'expired' })
      if (expired.ok) {
        return NextResponse.json({
          offer: {
            ...expired.row,
            assets: offer.assets,
            simulate: isOwlSwapSimulateSignature(expired.row.maker_deposit_sig),
          },
          expired: true,
        })
      }
    }

    return NextResponse.json({
      offer: {
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
        /** True when maker opened with a sim: deposit (no on-chain custody). */
        simulate: isOwlSwapSimulateSignature(offer.maker_deposit_sig),
      },
    })
  } catch (e) {
    console.error('owl-swap by-code GET', e)
    return NextResponse.json({ error: 'Failed to load offer' }, { status: 500 })
  }
}
