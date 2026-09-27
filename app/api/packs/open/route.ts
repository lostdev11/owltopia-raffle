import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { PublicKey } from '@solana/web3.js'
import { assertPacksAccess } from '@/lib/packs/assert-access'
import { getPackOpenById } from '@/lib/packs/db'
import { confirmAndOpenPack } from '@/lib/packs/open-engine'
import { payoutCommittedPackOpen } from '@/lib/packs/open-payout'
import { isPackOpenRetryableError } from '@/lib/packs/pack-open-errors'
import { packRevealMessage } from '@/lib/packs/reveal-message'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Finish vault payout after the HTTP response so “Open pack” unlocks as soon as
 * the prize is reserved (VRF + roll). Failures stay in reserved/paying_out for
 * pack-open reconcile.
 */
function scheduleDeferredPackPayout(openId: string, buyerWallet: string): void {
  waitUntil(
    (async () => {
      try {
        const open = await getPackOpenById(openId)
        if (!open || open.status === 'completed' || open.status === 'refund_needed') return
        if (!open.open_seed || !open.open_commit_hash || !open.category) return
        await payoutCommittedPackOpen({ open, buyerWallet })
      } catch (e) {
        console.error('[packs] deferred payout failed', openId, e)
      }
    })()
  )
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`packs-open:ip:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const openId = typeof body.openId === 'string' ? body.openId.trim() : ''
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
    const paymentSignature =
      typeof body.paymentSignature === 'string' ? body.paymentSignature.trim() : ''

    if (!openId || !wallet || !paymentSignature) {
      return NextResponse.json(
        { error: 'openId, wallet, and paymentSignature are required' },
        { status: 400 }
      )
    }
    try {
       
      new PublicKey(wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const access = await assertPacksAccess(wallet)
    if (access !== true) return access

    const result = await confirmAndOpenPack({
      openId,
      buyerWallet: wallet,
      paymentSignature,
      deferPayout: true,
    })

    const payoutPending = !result.payoutSignature
    if (payoutPending) {
      scheduleDeferredPackPayout(result.openId, wallet)
    }

    return NextResponse.json({
      success: true,
      result: {
        ...result,
        revealMessage: packRevealMessage({
          category: result.category,
          prizeLabel: result.prizeLabel,
          isJackpotWin: result.isJackpotWin,
          payoutPending,
        }),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Pack open failed'
    console.error('[packs] open', e)
    const retryable = isPackOpenRetryableError(e)
    return NextResponse.json(
      { error: msg, retryable },
      { status: retryable ? 503 : 400 }
    )
  }
}
