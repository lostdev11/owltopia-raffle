import { Connection, LAMPORTS_PER_SOL, type ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'

import {
  getGen2PresalePublicOffer,
  getGen2PresaleServerConfig,
  type Gen2PresaleEnvConfig,
} from '@/lib/gen2-presale/config'
import { getBalanceByWallet, sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import {
  GEN2_PRESALE_MAX_CREDITS_PER_WALLET,
  GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE,
  GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE,
  gen2PresaleTotalCreditsOnWallet,
} from '@/lib/gen2-presale/max-per-purchase'
import {
  computePurchaseLamports,
  lamportsPerSpot,
  type Gen2PriceBreakdown,
} from '@/lib/gen2-presale/pricing'
import { bigintToRpcParam } from '@/lib/gen2-presale/rpc-bigint'
import {
  feePayerMatchesBuyer,
  fetchParsedTransactionConfirmed,
  parseGen2PresaleFounderPaymentTotals,
  verifyGen2PresalePaymentChainAligned,
  verifyGen2PresalePayments,
} from '@/lib/gen2-presale/verify-payment'
import { gen2PresaleExplorerTxUrl } from '@/lib/gen2-presale/explorer'
import type { Gen2PresaleBalance, Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

/** Matches {@link verifyGen2PresalePaymentChainAligned} per-spot SOL bounds (unreasonable_unit). */
const CHAIN_INFERENCE_MIN_UNIT_LAMPORTS = BigInt(Math.ceil(0.0005 * LAMPORTS_PER_SOL))
const CHAIN_INFERENCE_MAX_UNIT_LAMPORTS = BigInt(Math.floor(100 * LAMPORTS_PER_SOL))

/**
 * Integer spot counts compatible with `total` lamports to founders under chain-aligned rules.
 * Results are clamped to {@link GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE}.
 */
export function computeGen2PresaleQuantityBoundsFromTotal(
  total: bigint
): { minQ: number; maxQ: number } | null {
  if (total <= 0n || CHAIN_INFERENCE_MIN_UNIT_LAMPORTS <= 0n) return null

  let maxQ = total / CHAIN_INFERENCE_MIN_UNIT_LAMPORTS
  if (maxQ < 1n) return null

  let minQ = (total + CHAIN_INFERENCE_MAX_UNIT_LAMPORTS - 1n) / CHAIN_INFERENCE_MAX_UNIT_LAMPORTS
  if (minQ < 1n) minQ = 1n

  if (maxQ > BigInt(GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE)) {
    maxQ = BigInt(GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE)
  }

  if (minQ > maxQ) return null

  return { minQ: Number(minQ), maxQ: Number(maxQ) }
}

/**
 * Valid spot counts for integer total lamports (must divide `total`), ordered by how close they are
 * to the oracle-implied count {@link lamportsPerSpot} — avoids picking the wrong divisor when many
 * integers divide `total` evenly (chain-aligned verification is ambiguous).
 *
 * Product rule: **credits scale with total lamports to founders** vs the configured USDC spot price
 * (via SOL/USD)—same mental model as “~0.95 SOL total ≈ three spots at ~$20 each,” not per explorer line.
 */
export function enumerateGen2PresaleQuantityCandidates(
  total: bigint,
  cfg: Gen2PresaleEnvConfig,
  minQ: number,
  maxQ: number
): number[] {
  const unit = lamportsPerSpot(cfg)
  if (unit <= 0n || minQ > maxQ) return []

  const qApprox = (total + unit / 2n) / unit
  let hint = Number(qApprox)
  if (!Number.isFinite(hint)) hint = minQ
  hint = Math.min(maxQ, Math.max(minQ, Math.round(hint)))

  const divisors: number[] = []
  for (let q = minQ; q <= maxQ; q++) {
    const qb = BigInt(q)
    if (total % qb === 0n) divisors.push(q)
  }

  divisors.sort((a, b) => {
    const da = Math.abs(a - hint)
    const db = Math.abs(b - hint)
    if (da !== db) return da - db
    return a - b
  })

  return divisors
}

/**
 * When several spot counts verify for the same founder payment total, chain-aligned rules accept
 * any divisor of total lamports within bounds — so multiple `q` can pass
 * {@link getVerifiedBreakdownForQuantity}. Picking the first candidate by hint-distance can
 * under-report spots when the rounded hint is between two valid divisors.
 *
 * Choose the quantity whose implied per-spot SOL/USD (and unit lamports) best matches the server
 * oracle {@link Gen2PresaleEnvConfig.solUsdPrice} / {@link lamportsPerSpot}.
 */
export function pickBestGen2PresaleQuantityFromCandidates(
  candidates: number[],
  cfg: Gen2PresaleEnvConfig,
  buyerNorm: string,
  parsed: ParsedTransactionWithMeta
): { quantity: number; breakdown: Gen2PriceBreakdown } | null {
  const unitTarget = lamportsPerSpot(cfg)
  let best: {
    quantity: number
    breakdown: Gen2PriceBreakdown
    usdDiff: number
    unitDiff: bigint
  } | null = null

  for (const q of candidates) {
    const breakdown = getVerifiedBreakdownForQuantity(cfg, buyerNorm, parsed, q)
    if (!breakdown) continue

    const usdDiff = Math.abs(breakdown.solUsdPrice - cfg.solUsdPrice)
    const u = breakdown.unitLamports
    const unitDiff = u >= unitTarget ? u - unitTarget : unitTarget - u

    if (!best) {
      best = { quantity: q, breakdown, usdDiff, unitDiff }
      continue
    }
    if (usdDiff < best.usdDiff - 1e-12) {
      best = { quantity: q, breakdown, usdDiff, unitDiff }
      continue
    }
    if (Math.abs(usdDiff - best.usdDiff) <= 1e-12) {
      if (unitDiff < best.unitDiff) {
        best = { quantity: q, breakdown, usdDiff, unitDiff }
      } else if (unitDiff === best.unitDiff && q > best.quantity) {
        best = { quantity: q, breakdown, usdDiff, unitDiff }
      }
    }
  }

  return best ? { quantity: best.quantity, breakdown: best.breakdown } : null
}

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
 * Match on-chain founder transfers to a quantity using the same rules as confirm (incl. chain-aligned SOL drift).
 */
export function getVerifiedBreakdownForQuantity(
  cfg: Gen2PresaleEnvConfig,
  buyerNorm: string,
  parsed: ParsedTransactionWithMeta,
  qty: number
): Gen2PriceBreakdown | null {
  let breakdown = computePurchaseLamports(cfg, qty)
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

  if (!v.ok) return null
  return breakdown
}

/**
 * Resolve spot count from a parsed payment tx by scanning quantities compatible with total lamports
 * paid to founders (same rules as chain backfill).
 */
export async function resolveGen2PresaleQuantityFromParsedTx(params: {
  buyerWallet: string
  parsedTx: ParsedTransactionWithMeta
  solUsdPriceUsed?: number
}): Promise<
  | { ok: true; buyerWallet: string; quantity: number; breakdown: Gen2PriceBreakdown }
  | { ok: false; code: string; message: string }
> {
  const buyerNorm = normalizeSolanaWalletAddress(params.buyerWallet)
  if (!buyerNorm) {
    return { ok: false, code: 'invalid_wallet', message: 'Invalid buyer wallet' }
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
    return { ok: false, code: 'config', message: msg }
  }

  const buyerPk = new PublicKey(buyerNorm)
  if (!feePayerMatchesBuyer(params.parsedTx, buyerPk)) {
    return {
      ok: false,
      code: 'wrong_signer',
      message: 'Transaction fee payer does not match wallet',
    }
  }

  const split = parseGen2PresaleFounderPaymentTotals({
    parsed: params.parsedTx,
    buyerWallet: buyerNorm,
    founderA: cfg.founderA.toBase58(),
    founderB: cfg.founderB.toBase58(),
    pctA: cfg.founderAPercent,
    pctB: cfg.founderBPercent,
  })
  if (!split.ok) {
    return {
      ok: false,
      code: 'payment_mismatch',
      message:
        split.reason === 'split_mismatch'
          ? 'Founder payment split does not match expected presale routing'
          : 'Could not read presale payment transfers',
    }
  }

  const bounds = computeGen2PresaleQuantityBoundsFromTotal(split.total)
  if (!bounds) {
    return {
      ok: false,
      code: 'payment_mismatch',
      message: 'Could not infer spot count from payment amount',
    }
  }

  const candidates = enumerateGen2PresaleQuantityCandidates(
    split.total,
    cfg,
    bounds.minQ,
    bounds.maxQ
  )
  const picked = pickBestGen2PresaleQuantityFromCandidates(
    candidates,
    cfg,
    buyerNorm,
    params.parsedTx
  )
  if (picked) {
    return {
      ok: true,
      buyerWallet: buyerNorm,
      quantity: picked.quantity,
      breakdown: picked.breakdown,
    }
  }

  return {
    ok: false,
    code: 'payment_mismatch',
    message: `Could not match transaction to any spot count (${bounds.minQ}–${bounds.maxQ} from paid amount)`,
  }
}

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
  /**
   * Public confirm routes default to {@link GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}.
   * Chain backfill may record larger quantities inferred from lamports.
   */
  quantityCap?: number
}): Promise<Gen2ConfirmResult> {
  const buyerNorm = normalizeSolanaWalletAddress(params.buyerWallet)
  if (!buyerNorm) {
    return { ok: false, httpStatus: 400, message: 'Invalid buyer wallet' }
  }

  const qty = params.quantity
  const quantityCap = params.quantityCap ?? GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > quantityCap) {
    return {
      ok: false,
      httpStatus: 400,
      message: `quantity must be an integer from 1 to ${quantityCap}`,
    }
  }

  const creditsBefore = gen2PresaleTotalCreditsOnWallet(await getBalanceByWallet(buyerNorm))
  if (creditsBefore + qty > GEN2_PRESALE_MAX_CREDITS_PER_WALLET) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'wallet_cap',
      message: `Each wallet can hold at most ${GEN2_PRESALE_MAX_CREDITS_PER_WALLET} presale credits (current total ${creditsBefore}).`,
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

  const breakdown = getVerifiedBreakdownForQuantity(cfg, buyerNorm, parsed, qty)
  if (!breakdown) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'payment_mismatch',
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
    if (result.error === 'wallet_cap') {
      return {
        ok: false,
        httpStatus: 409,
        code: 'wallet_cap',
        message: `Each wallet can hold at most ${GEN2_PRESALE_MAX_CREDITS_PER_WALLET} presale credits.`,
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
 * Resolve spot count from founder payment total, then confirm once. Divisors of the on-chain total
 * can all verify under chain-aligned rules; the chosen quantity is
 * {@link pickBestGen2PresaleQuantityFromCandidates} (oracle / per-spot match), not first by hint
 * distance.
 */
export async function executeGen2PresaleConfirmWithQuantitySearch(params: {
  buyerWallet: string
  txSignature: string
  /** Optional upper bound on inferred quantity (testing / safety). */
  maxQty?: number
  parsedTx?: ParsedTransactionWithMeta | null
  /** Defaults to {@link GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE} for DB writes. */
  quantityCap?: number
}): Promise<(Gen2ConfirmResult & { quantityTried: number[] }) | (Gen2ConfirmFail & { quantityTried: number[] })> {
  const tried: number[] = []
  let lastFail: Gen2ConfirmFail | null = null
  const quantityCap = params.quantityCap ?? GEN2_PRESALE_MAX_SPOTS_CHAIN_INFERENCE

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

  let cfg
  try {
    cfg = await getGen2PresaleServerConfig()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server configuration error'
    return { ok: false, httpStatus: 500, message: msg, quantityTried: [] }
  }

  const buyerNormEarly = normalizeSolanaWalletAddress(params.buyerWallet)
  if (!buyerNormEarly) {
    return { ok: false, httpStatus: 400, message: 'Invalid buyer wallet', quantityTried: [] }
  }
  const buyerPkEarly = new PublicKey(buyerNormEarly)
  if (!feePayerMatchesBuyer(parsedOnce, buyerPkEarly)) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'wrong_signer',
      message: 'Transaction fee payer does not match wallet',
      quantityTried: [],
    }
  }

  const split = parseGen2PresaleFounderPaymentTotals({
    parsed: parsedOnce,
    buyerWallet: buyerNormEarly,
    founderA: cfg.founderA.toBase58(),
    founderB: cfg.founderB.toBase58(),
    pctA: cfg.founderAPercent,
    pctB: cfg.founderBPercent,
  })
  if (!split.ok) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'payment_mismatch',
      message:
        split.reason === 'split_mismatch'
          ? 'Founder payment split does not match expected presale routing'
          : 'Could not read presale payment transfers',
      quantityTried: [],
    }
  }

  const boundsRaw = computeGen2PresaleQuantityBoundsFromTotal(split.total)
  if (!boundsRaw) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'payment_mismatch',
      message: 'Could not infer spot count from payment amount',
      quantityTried: [],
    }
  }

  let maxQ = Math.min(boundsRaw.maxQ, quantityCap)
  if (params.maxQty != null) {
    maxQ = Math.min(maxQ, params.maxQty)
  }
  const minQ = boundsRaw.minQ
  if (minQ > maxQ) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'payment_mismatch',
      message: 'Could not infer spot count from payment amount',
      quantityTried: [],
    }
  }

  const candidates = enumerateGen2PresaleQuantityCandidates(split.total, cfg, minQ, maxQ)
  const picked = pickBestGen2PresaleQuantityFromCandidates(
    candidates,
    cfg,
    buyerNormEarly,
    parsedOnce
  )
  if (picked) {
    tried.push(...candidates)
    const r = await executeGen2PresaleConfirm({
      buyerWallet: params.buyerWallet,
      quantity: picked.quantity,
      txSignature: params.txSignature,
      parsedTx: parsedOnce,
      quantityCap,
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
    if (r.code === 'sold_out' || r.code === 'wallet_cap') {
      return { ...r, quantityTried: tried }
    }
    lastFail = r
  } else {
    for (const q of candidates) {
      tried.push(q)
    }
    lastFail = {
      ok: false,
      httpStatus: 400,
      code: 'payment_mismatch',
      message: 'Could not verify founder payments in this transaction',
    }
  }

  return {
    ...(lastFail ?? {
      ok: false,
      httpStatus: 400,
      code: 'payment_mismatch',
      message: `Could not match transaction to any spot count (${minQ}–${maxQ} from paid amount)`,
    }),
    quantityTried: tried,
  }
}
