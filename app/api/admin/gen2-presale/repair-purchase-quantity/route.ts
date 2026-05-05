import { Connection } from '@solana/web3.js'
import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { resolveGen2PresaleQuantityFromParsedTx } from '@/lib/gen2-presale/confirm-core'
import { getGen2PresaleServerConfig } from '@/lib/gen2-presale/config'
import { fetchParsedTransactionConfirmed, getFeePayerPublicKey } from '@/lib/gen2-presale/verify-payment'
import { bigintToRpcParam } from '@/lib/gen2-presale/rpc-bigint'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Re-verify a purchase signature on-chain and fix DB quantity / lamports / buyer balance when the
 * stored row under-reported spots (e.g. old backfill used quantity 1 for a multi-spot payment).
 */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  const rl = rateLimit(`gen2-repair-qty:${ip}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many repair requests — wait a minute.' }, { status: 429 })
  }

  let body: { txSignature?: string }
  try {
    body = (await request.json().catch(() => ({}))) as typeof body
  } catch {
    body = {}
  }

  const rawSig = typeof body.txSignature === 'string' ? body.txSignature.trim() : ''
  if (!rawSig) {
    return NextResponse.json({ error: 'txSignature is required' }, { status: 400 })
  }

  let cfg
  try {
    cfg = await getGen2PresaleServerConfig()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server configuration error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const rpcUrl = resolveServerSolanaRpcUrl()
  const connection = new Connection(rpcUrl, 'confirmed')
  const parsed = await fetchParsedTransactionConfirmed(connection, rawSig)
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          'Could not load this transaction from your Solana RPC (parsed tx was null). Common causes: the tx is on mainnet but the server uses a devnet RPC (or the opposite), a typo in the signature, or an RPC that dropped getParsedTransaction. Set NEXT_PUBLIC_SOLANA_RPC_URL or SOLANA_RPC_URL to an HTTP endpoint on the same cluster where the payment was made, redeploy, then retry.',
        rpc_host: (() => {
          try {
            return new URL(rpcUrl).hostname
          } catch {
            return undefined
          }
        })(),
      },
      { status: 404 }
    )
  }
  if (parsed.meta?.err) {
    return NextResponse.json(
      {
        error:
          'This transaction failed on-chain, so it cannot be used for presale repair. Use a successful payment signature.',
        chain_err: parsed.meta.err,
      },
      { status: 404 }
    )
  }

  const feePayer = getFeePayerPublicKey(parsed)
  if (!feePayer) {
    return NextResponse.json({ error: 'Could not determine fee payer' }, { status: 400 })
  }

  const resolved = await resolveGen2PresaleQuantityFromParsedTx({
    buyerWallet: feePayer.toBase58(),
    parsedTx: parsed,
  })
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.message, code: resolved.code },
      { status: resolved.code === 'wrong_signer' ? 400 : 422 }
    )
  }

  const db = getSupabaseAdmin()
  const { data: row, error: selErr } = await db
    .from('gen2_presale_purchases')
    .select('wallet,quantity,total_lamports,founder_a_lamports,founder_b_lamports')
    .eq('tx_signature', rawSig)
    .maybeSingle()

  if (selErr) {
    console.error('repair purchase select:', selErr.message)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ error: 'No purchase row for this signature — nothing to repair' }, { status: 404 })
  }

  const rowWallet = normalizeSolanaWalletAddress(String((row as { wallet: string }).wallet))
  if (!rowWallet || rowWallet !== resolved.buyerWallet) {
    return NextResponse.json(
      {
        error: 'Stored wallet does not match transaction fee payer',
        stored_wallet: rowWallet,
        fee_payer: resolved.buyerWallet,
      },
      { status: 409 }
    )
  }

  const prevQty = Number((row as { quantity: number }).quantity)
  const sameQty = prevQty === resolved.quantity
  const prevTotal = String((row as { total_lamports: string | number }).total_lamports)
  const newTotalStr = bigintToRpcParam(resolved.breakdown.totalLamports)
  if (sameQty && prevTotal === newTotalStr) {
    const { data: recResult, error: recErr } = await db.rpc('reconcile_gen2_presale_wallet_purchased_mints', {
      p_wallet: resolved.buyerWallet,
    })

    if (recErr) {
      console.error('reconcile_gen2_presale_wallet_purchased_mints:', recErr.message)
      return NextResponse.json(
        { error: 'Wallet reconcile failed — apply migration 100_gen2_presale_reconcile_wallet_balance or check logs.' },
        { status: 500 }
      )
    }

    const rec = recResult as {
      ok?: boolean
      reconciled?: boolean
      unchanged?: boolean
      error?: string
      delta?: number
      previous_purchased_mints?: number
      new_purchased_mints?: number
      reason?: string
    } | null

    if (rec?.ok === false) {
      return NextResponse.json({ error: rec.error ?? 'reconcile_failed', detail: rec }, { status: 409 })
    }

    const purchaseRowUnchanged = true
    const balanceSynced = rec?.reconciled === true

    return NextResponse.json({
      ok: true,
      unchanged: !balanceSynced,
      purchase_row_unchanged: purchaseRowUnchanged,
      balance_reconciled: balanceSynced,
      tx_signature: rawSig,
      wallet: resolved.buyerWallet,
      quantity: resolved.quantity,
      message: balanceSynced
        ? 'Purchase row matched chain; wallet purchased_mints updated to match all confirmed purchase rows for this wallet.'
        : 'Purchase row matched chain; wallet balance already matched the sum of confirmed purchases.',
      reconcile: rec,
    })
  }

  const { data: rpcResult, error: rpcError } = await db.rpc('repair_gen2_presale_purchase_quantity', {
    p_tx_signature: rawSig,
    p_wallet: resolved.buyerWallet,
    p_new_quantity: resolved.quantity,
    p_unit_price_usdc: cfg.priceUsdc,
    p_sol_usd_price: resolved.breakdown.solUsdPrice,
    p_total_lamports: bigintToRpcParam(resolved.breakdown.totalLamports),
    p_founder_a_lamports: bigintToRpcParam(resolved.breakdown.founderALamports),
    p_founder_b_lamports: bigintToRpcParam(resolved.breakdown.founderBLamports),
    p_presale_supply: cfg.presaleSupply,
  })

  if (rpcError) {
    console.error('repair_gen2_presale_purchase_quantity:', rpcError.message)
    return NextResponse.json({ error: 'Repair RPC failed — apply migration 098 or check logs.' }, { status: 500 })
  }

  const result = rpcResult as {
    ok?: boolean
    error?: string
    unchanged?: boolean
    quantity?: number
    previous_quantity?: number
    delta?: number
  } | null

  if (result?.ok === false) {
    const err = result.error ?? 'unknown'
    const status = err === 'sold_out' ? 409 : err === 'wallet_mismatch' ? 409 : 400
    return NextResponse.json({ error: err, detail: result }, { status })
  }

  return NextResponse.json({
    ok: true,
    tx_signature: rawSig,
    wallet: resolved.buyerWallet,
    resolved_quantity: resolved.quantity,
    rpc: result,
  })
}
