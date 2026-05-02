import { Connection, PublicKey } from '@solana/web3.js'
import { NextRequest, NextResponse } from 'next/server'

import { getGen2PresaleServerConfig } from '@/lib/gen2-presale/config'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE } from '@/lib/gen2-presale/max-per-purchase'
import { computePurchaseLamports } from '@/lib/gen2-presale/pricing'
import { bigintToRpcParam } from '@/lib/gen2-presale/rpc-bigint'
import {
  feePayerMatchesBuyer,
  fetchParsedTransactionConfirmed,
  verifyGen2PresalePayments,
} from '@/lib/gen2-presale/verify-payment'
import { gen2PresaleExplorerTxUrl } from '@/lib/gen2-presale/explorer'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

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

    let cfg
    try {
      cfg = await getGen2PresaleServerConfig(solUsdOverride != null ? { solUsdPrice: solUsdOverride } : undefined)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Server configuration error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const breakdown = computePurchaseLamports(cfg, qty)
    const buyerPk = new PublicKey(buyerNorm)

    const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
    const parsed = await fetchParsedTransactionConfirmed(connection, txSignature)
    if (!parsed) {
      return NextResponse.json(
        { error: 'Transaction not found or not confirmed yet', code: 'tx_not_found' },
        { status: 404 }
      )
    }

    if (!feePayerMatchesBuyer(parsed, buyerPk)) {
      return NextResponse.json({ error: 'Transaction fee payer does not match wallet', code: 'wrong_signer' }, { status: 400 })
    }

    const v = verifyGen2PresalePayments({
      parsed,
      buyerWallet: buyerNorm,
      founderA: cfg.founderA.toBase58(),
      founderB: cfg.founderB.toBase58(),
      expectA: breakdown.founderALamports,
      expectB: breakdown.founderBLamports,
    })
    if (!v.ok) {
      const code =
        v.reason === 'failed'
          ? 'tx_failed'
          : v.reason === 'not_found'
            ? 'tx_not_found'
            : 'payment_mismatch'
      const status = v.reason === 'failed' ? 400 : 400
      return NextResponse.json(
        { error: 'Could not verify founder payments in this transaction', code },
        { status }
      )
    }

    const db = getSupabaseAdmin()
    const { data: rpcResult, error: rpcError } = await db.rpc('confirm_gen2_presale_purchase', {
      p_wallet: buyerNorm,
      p_quantity: qty,
      p_unit_price_usdc: cfg.priceUsdc,
      p_sol_usd_price: cfg.solUsdPrice,
      p_total_lamports: bigintToRpcParam(breakdown.totalLamports),
      p_founder_a_lamports: bigintToRpcParam(breakdown.founderALamports),
      p_founder_b_lamports: bigintToRpcParam(breakdown.founderBLamports),
      p_tx_signature: txSignature,
      p_presale_supply: cfg.presaleSupply,
    })

    if (rpcError) {
      console.error('confirm_gen2_presale_purchase RPC:', rpcError.message)
      return NextResponse.json({ error: 'Database error', code: 'db_error' }, { status: 500 })
    }

    const result = rpcResult as { ok?: boolean; error?: string } | null
    if (result?.ok === false) {
      if (result.error === 'duplicate_tx') {
        return NextResponse.json({ error: 'This transaction was already recorded', code: 'duplicate_tx' }, { status: 409 })
      }
      if (result.error === 'sold_out') {
        return NextResponse.json({ error: 'Presale sold out', code: 'sold_out' }, { status: 409 })
      }
    }

    const balance = await getBalanceByWallet(buyerNorm)

    return NextResponse.json({
      ok: true,
      txSignature: txSignature,
      explorerUrl: gen2PresaleExplorerTxUrl(txSignature),
      balance: balance ?? {
        wallet: buyerNorm,
        purchased_mints: qty,
        gifted_mints: 0,
        used_mints: 0,
        available_mints: qty,
      },
    })
  } catch (error) {
    console.error('gen2-presale confirm:', error)
    return NextResponse.json({ error: 'Confirmation failed' }, { status: 500 })
  }
}
