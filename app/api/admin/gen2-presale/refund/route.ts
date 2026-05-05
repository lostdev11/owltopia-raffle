import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type RefundRpcResult = {
  ok?: boolean
  error?: string
  refunded_quantity?: number
  wallet?: string
  purchase_tx_signature?: string | null
  max_refundable?: number
  requested_refund?: number
  purchased_mints?: number
  gifted_mints?: number
  used_mints?: number
  status?: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rlIp = rateLimit(`gen2-refund-ip:${ip}`, 30, 60_000)
    const rlActor = rateLimit(`gen2-refund-actor:${session.wallet}`, 20, 60_000)
    if (!rlIp.allowed || !rlActor.allowed) {
      return NextResponse.json(
        { error: 'Too many refund requests — wait a minute and retry.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    let body: {
      wallet?: string
      quantity?: number
      purchaseTxSignature?: string
      refundTxSignature?: string
      reason?: string
    }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const wallet = normalizeSolanaWalletAddress(typeof body.wallet === 'string' ? body.wallet : '')
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const actorNorm = normalizeSolanaWalletAddress(session.wallet)
    if (!actorNorm) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    const purchaseTxSignature =
      typeof body.purchaseTxSignature === 'string' && body.purchaseTxSignature.trim()
        ? body.purchaseTxSignature.trim()
        : null
    const refundTxSignature =
      typeof body.refundTxSignature === 'string' && body.refundTxSignature.trim()
        ? body.refundTxSignature.trim()
        : null
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null

    const rawQty = Number(body.quantity)
    const quantity = Number.isFinite(rawQty) ? Math.floor(rawQty) : null
    if (!purchaseTxSignature && (!quantity || quantity < 1)) {
      return NextResponse.json(
        { error: 'quantity must be >= 1 when purchaseTxSignature is not provided' },
        { status: 400 }
      )
    }
    if (quantity && quantity > 500) {
      return NextResponse.json({ error: 'quantity must be between 1 and 500' }, { status: 400 })
    }

    const db = getSupabaseAdmin()
    const { data, error } = await db.rpc('refund_gen2_presale_mints', {
      p_actor_wallet: actorNorm,
      p_recipient_wallet: wallet,
      p_quantity: quantity,
      p_purchase_tx_signature: purchaseTxSignature,
      p_refund_tx_signature: refundTxSignature,
      p_reason: reason,
    })

    if (error) {
      const msg = error.message || ''
      if (msg.includes('does not exist') || msg.includes('42883')) {
        return NextResponse.json(
          {
            error:
              'Refund RPC out of date. Apply Supabase migration 101_gen2_presale_refunds.sql (refund audit + RPC).',
          },
          { status: 503 }
        )
      }
      console.error('admin gen2-presale refund:', error)
      return NextResponse.json({ error: msg || 'Refund failed' }, { status: 500 })
    }

    const result = (data ?? {}) as RefundRpcResult
    if (result.ok === false) {
      const code = result.error ?? 'refund_failed'
      const status = code === 'already_refunded' || code === 'purchase_not_found' ? 409 : 400
      return NextResponse.json({ error: code, detail: result }, { status })
    }

    console.info(
      JSON.stringify({
        tag: 'gen2_presale_refund',
        actorWallet: actorNorm,
        recipientWallet: wallet,
        requestedQuantity: quantity,
        refundedQuantity: result.refunded_quantity ?? null,
        purchaseTxSignature,
        refundTxSignature,
        ts: new Date().toISOString(),
      })
    )

    const balance = await getBalanceByWallet(wallet)
    return NextResponse.json({ ok: true, result, balance })
  } catch (error) {
    console.error('admin gen2-presale refund:', error)
    return NextResponse.json({ error: 'Refund failed' }, { status: 500 })
  }
}
