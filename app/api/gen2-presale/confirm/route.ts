import { NextRequest, NextResponse } from 'next/server'

import { executeGen2PresaleConfirm } from '@/lib/gen2-presale/confirm-core'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE } from '@/lib/gen2-presale/max-per-purchase'

export const dynamic = 'force-dynamic'

const SIG_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-confirm:${ip}`, 40, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    let body: { buyerWallet?: string; quantity?: number; txSignature?: string; solUsdPriceUsed?: number | string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const buyerNorm = normalizeSolanaWalletAddress(typeof body.buyerWallet === 'string' ? body.buyerWallet : '')
    if (!buyerNorm) {
      return NextResponse.json({ error: 'Invalid buyer wallet' }, { status: 400 })
    }

    const qty = Number(body.quantity)
    if (
      !Number.isFinite(qty) ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE
    ) {
      return NextResponse.json(
        { error: `quantity must be an integer from 1 to ${GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}` },
        { status: 400 }
      )
    }

    const txSignature = typeof body.txSignature === 'string' ? body.txSignature.trim() : ''
    if (!txSignature || !SIG_REGEX.test(txSignature)) {
      return NextResponse.json({ error: 'Invalid transaction signature' }, { status: 400 })
    }

    const rawSolUsd = body.solUsdPriceUsed
    let solUsdOverride: number | undefined
    if (typeof rawSolUsd === 'number' && Number.isFinite(rawSolUsd) && rawSolUsd > 0) {
      solUsdOverride = rawSolUsd
    } else if (typeof rawSolUsd === 'string' && rawSolUsd.trim()) {
      const n = Number(rawSolUsd.trim())
      if (Number.isFinite(n) && n > 0) solUsdOverride = n
    }

    const result = await executeGen2PresaleConfirm({
      buyerWallet: buyerNorm,
      quantity: qty,
      txSignature,
      solUsdPriceUsed: solUsdOverride,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.httpStatus }
      )
    }

    if (!result.inserted && result.reason === 'duplicate_tx') {
      return NextResponse.json(
        {
          error: 'This transaction was already recorded',
          code: 'duplicate_tx',
          txSignature: result.txSignature,
          explorerUrl: result.explorerUrl,
          balance: result.balance,
          stats: result.stats,
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      ok: true,
      txSignature: result.txSignature,
      explorerUrl: result.explorerUrl,
      balance: result.balance,
      stats: result.stats,
    })
  } catch (error) {
    console.error('gen2-presale confirm:', error)
    return NextResponse.json({ error: 'Confirmation failed' }, { status: 500 })
  }
}
