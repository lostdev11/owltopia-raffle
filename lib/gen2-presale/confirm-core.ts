import { Connection, type ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'

import { getGen2PresalePublicOffer, getGen2PresaleServerConfig } from '@/lib/gen2-presale/config'
import { getBalanceByWallet, sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import { GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE } from '@/lib/gen2-presale/max-per-purchase'
import { computePurchaseLamports } from '@/lib/gen2-presale/pricing'
import { bigintToRpcParam } from '@/lib/gen2-presale/rpc-bigint'
import {
  feePayerMatchesBuyer,
  fetchParsedTransactionConfirmed,
  verifyGen2PresalePaymentChainAligned,
  verifyGen2PresalePayments,
} from '@/lib/gen2-presale/verify-payment'
import { gen2PresaleExplorerTxUrl } from '@/lib/gen2-presale/explorer'
import type { Gen2PresaleBalance, Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export type Gen2ConfirmOkInserted = {
  ok: true
  inserted: true
  txSignature: string
  buyerWallet: string
  quantity: number
  balance: Gen2PresaleBalance
  stats: Pick<Gen2PresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
  explorerUrl: string | null
}

export type Gen2ConfirmOkDuplicate = {
  ok: true
  inserted: false
  reason: 'duplicate_tx'
  txSignature: string
  buyerWallet: string
  balance: Gen2PresaleBalance
  stats: Pick<Gen2PresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
  explorerUrl: string | null
}

export type Gen2ConfirmFail = {
  ok: false
  httpStatus: number
  code?: string
  message: string
}

export type Gen2ConfirmResult = Gen2ConfirmOkInserted | Gen2ConfirmOkDuplicate | Gen2ConfirmFail

/**
 * Shared implementation for recording a presale payment (public confirm route + admin backfill).
 */
export async function executeGen2PresaleConfirm(params: {
  buyerWallet: string
  quantity: number
  txSignature: string
  solUsdPriceUsed?: number
  /** When provided, skips re-fetching the transaction (backfill / quantity search). */
  parsedTx?: ParsedTransactionWithMeta | null
}): Promise<Gen2ConfirmResult> {
  const buyerNorm = normalizeSolanaWalletAddress(params.buyerWallet)
  if (!buyerNorm) {
    return { ok: false, httpStatus: 400, message: 'Invalid buyer wallet' }
  }

  const qty = params.quantity
  if (
    !Number.isFinite(qty) ||
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty > GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE
  ) {
    return {
      ok: false,
      httpStatus: 400,
      message: `quantity must be an integer from 1 to ${GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}`,
    }
  }

  let solUsdOverride: number | undefined
  const raw = params.solUsdPriceUsed
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    solUsdOverride = raw
  }

  let cfg
  try {
    cfg = await getGen2PresaleServerConfig(solUsdOverride != null ? { solUsdPrice: solUsdOverride } : undefined)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server configuration error'
    return { ok: false, httpStatus: 500, message: msg }
  }

  let breakdown = computePurchaseLamports(cfg, qty)
  const buyerPk = new PublicKey(buyerNorm)

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  const parsed =
    params.parsedTx ??
    (await fetchParsedTransactionConfirmed(connection, params.txSignature))
  if (!parsed) {
    return { ok: false, httpStatus: 404, code: 'tx_not_found', message: 'Transaction not found or not confirmed yet' }
  }

  if (!feePayerMatchesBuyer(parsed, buyerPk)) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'wrong_signer',
      message: 'Transaction fee payer does not match wallet',
    }
  }

  let v = verifyGen2PresalePayments({
    parsed,
    buyerWallet: buyerNorm,
    founderA: cfg.founderA.toBase58(),
    founderB: cfg.founderB.toBase58(),
    expectA: breakdown.founderALamports,
    expectB: breakdown.founderBLamports,
  })

  if (!v.ok && v.reason === 'wrong_amounts') {
    const chain = verifyGen2PresalePaymentChainAligned({
      parsed,
      buyerWallet: buyerNorm,
      founderA: cfg.founderA.toBase58(),
      founderB: cfg.founderB.toBase58(),
      pctA: cfg.founderAPercent,
      pctB: cfg.founderBPercent,
      priceUsdc: cfg.priceUsdc,
      quantity: qty,
    })
    if (chain.ok) {
      breakdown = {
        unitPriceUsdc: cfg.priceUsdc,
        solUsdPrice: chain.impliedSolUsd,
        unitLamports: chain.totalLamports / BigInt(qty),
        totalLamports: chain.totalLamports,
        founderALamports: chain.founderALamports,
        founderBLamports: chain.founderBLamports,
      }
      v = verifyGen2PresalePayments({
        parsed,
        buyerWallet: buyerNorm,
        founderA: cfg.founderA.toBase58(),
        founderB: cfg.founderB.toBase58(),
        expectA: breakdown.founderALamports,
        expectB: breakdown.founderBLamports,
      })
    }
  }

  if (!v.ok) {
    const code =
      v.reason === 'failed'
        ? 'tx_failed'
        : v.reason === 'not_found'
          ? 'tx_not_found'
          : 'payment_mismatch'
    return {
      ok: false,
      httpStatus: 400,
      code,
      message: 'Could not verify founder payments in this transaction',
    }
  }

  const db = getSupabaseAdmin()
  const { data: rpcResult, error: rpcError } = await db.rpc('confirm_gen2_presale_purchase', {
    p_wallet: buyerNorm,
    p_quantity: qty,
    p_unit_price_usdc: cfg.priceUsdc,
    p_sol_usd_price: breakdown.solUsdPrice,
    p_total_lamports: bigintToRpcParam(breakdown.totalLamports),
    p_founder_a_lamports: bigintToRpcParam(breakdown.founderALamports),
    p_founder_b_lamports: bigintToRpcParam(breakdown.founderBLamports),
    p_tx_signature: params.txSignature,
    p_presale_supply: cfg.presaleSupply,
  })

  if (rpcError) {
    console.error('confirm_gen2_presale_purchase RPC:', rpcError.message)
    return { ok: false, httpStatus: 500, code: 'db_error', message: 'Database error' }
  }

  const result = rpcResult as { ok?: boolean; error?: string } | null
  if (result?.ok === false) {
    if (result.error === 'duplicate_tx') {
      const dupBalance = await getBalanceByWallet(buyerNorm)
      const dupBalancePayload: Gen2PresaleBalance =
        dupBalance ?? {
          wallet: buyerNorm,
          purchased_mints: 0,
          gifted_mints: 0,
          used_mints: 0,
          available_mints: 0,
        }
      const offerDup = getGen2PresalePublicOffer()
      const soldDup = await sumConfirmedPresaleSold()
      const remainingDup = Math.max(0, offerDup.presaleSupply - soldDup)
      const percentDup = offerDup.presaleSupply > 0 ? (soldDup / offerDup.presaleSupply) * 100 : 0
      return {
        ok: true,
        inserted: false,
        reason: 'duplicate_tx',
        txSignature: params.txSignature,
        buyerWallet: buyerNorm,
        balance: dupBalancePayload,
        stats: {
          presale_supply: offerDup.presaleSupply,
          sold: soldDup,
          remaining: remainingDup,
          percent_sold: percentDup,
        },
        explorerUrl: gen2PresaleExplorerTxUrl(params.txSignature),
      }
    }
    if (result.error === 'sold_out') {
      return { ok: false, httpStatus: 409, code: 'sold_out', message: 'Presale sold out' }
    }
  }

  const balance = await getBalanceByWallet(buyerNorm)
  const balancePayload: Gen2PresaleBalance =
    balance ?? {
      wallet: buyerNorm,
      purchased_mints: qty,
      gifted_mints: 0,
      used_mints: 0,
      available_mints: qty,
    }

  const offer = getGen2PresalePublicOffer()
  const sold = await sumConfirmedPresaleSold()
  const remaining = Math.max(0, offer.presaleSupply - sold)
  const percent_sold = offer.presaleSupply > 0 ? (sold / offer.presaleSupply) * 100 : 0

  return {
    ok: true,
    inserted: true,
    txSignature: params.txSignature,
    buyerWallet: buyerNorm,
    quantity: qty,
    balance: balancePayload,
    stats: {
      presale_supply: offer.presaleSupply,
      sold,
      remaining,
      percent_sold,
    },
    explorerUrl: gen2PresaleExplorerTxUrl(params.txSignature),
  }
}

/**
 * Try quantities 1..max until confirm succeeds (for chain backfill when qty unknown).
 */
export async function executeGen2PresaleConfirmWithQuantitySearch(params: {
  buyerWallet: string
  txSignature: string
  maxQty?: number
  parsedTx?: ParsedTransactionWithMeta | null
}): Promise<(Gen2ConfirmResult & { quantityTried: number[] }) | (Gen2ConfirmFail & { quantityTried: number[] })> {
  const max = Math.min(params.maxQty ?? GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE, GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE)
  const tried: number[] = []
  let lastFail: Gen2ConfirmFail | null = null

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  const parsedOnce =
    params.parsedTx ?? (await fetchParsedTransactionConfirmed(connection, params.txSignature))
  if (!parsedOnce) {
    return {
      ok: false,
      httpStatus: 404,
      code: 'tx_not_found',
      message: 'Transaction not found or not confirmed yet',
      quantityTried: [],
    }
  }

  for (let q = 1; q <= max; q++) {
    tried.push(q)
    const r = await executeGen2PresaleConfirm({
      buyerWallet: params.buyerWallet,
      quantity: q,
      txSignature: params.txSignature,
      parsedTx: parsedOnce,
    })
    if (r.ok) {
      return { ...r, quantityTried: tried }
    }
    if (r.code === 'wrong_signer' || r.code === 'tx_not_found' || r.code === 'tx_failed') {
      return { ...r, quantityTried: tried }
    }
    if (r.code === 'db_error' || r.httpStatus >= 500) {
      return { ...r, quantityTried: tried }
    }
    if (r.code === 'sold_out') {
      return { ...r, quantityTried: tried }
    }
    lastFail = r
  }

  return {
    ...(lastFail ?? {
      ok: false,
      httpStatus: 400,
      code: 'payment_mismatch',
      message: 'Could not match transaction to any spot count (1–' + max + ')',
    }),
    quantityTried: tried,
  }
}
