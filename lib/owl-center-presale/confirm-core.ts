import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import {
  feePayerMatchesBuyer,
  fetchParsedTransactionConfirmed,
} from '@/lib/gen2-presale/verify-payment'
import { verifyOwlCenterTreasuryPayment } from '@/lib/owl-center-presale/verify-payment'
import { gen2PresaleExplorerTxUrl } from '@/lib/gen2-presale/explorer'
import { bigintToRpcParam } from '@/lib/gen2-presale/rpc-bigint'
import type { OwlCenterPresaleTenantAdmin } from '@/lib/owl-center-presale/types'
import type { OwlCenterPresaleBalance, OwlCenterPresaleStats } from '@/lib/owl-center-presale/types'
import {
  getOwlCenterPresaleBalanceByWallet,
  owlCenterPresaleTotalCreditsOnWallet,
  sumOwlCenterPresaleSold,
} from '@/lib/owl-center-presale/db'
import {
  computeOwlCenterPurchaseLamports,
  getOwlCenterPresaleServerConfig,
  lamportsPerSpot,
  type OwlCenterPresaleCampaignConfig,
  type OwlCenterPriceBreakdown,
} from '@/lib/owl-center-presale/pricing'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { Connection, PublicKey } from '@solana/web3.js'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export { gen2PresaleExplorerTxUrl as owlCenterPresaleExplorerTxUrl }

export type OwlCenterConfirmOkInserted = {
  ok: true
  inserted: true
  txSignature: string
  buyerWallet: string
  quantity: number
  balance: OwlCenterPresaleBalance
  stats: Pick<OwlCenterPresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
  explorerUrl: string | null
}

export type OwlCenterConfirmOkDuplicate = {
  ok: true
  inserted: false
  reason: 'duplicate_tx'
  txSignature: string
  buyerWallet: string
  balance: OwlCenterPresaleBalance
  stats: Pick<OwlCenterPresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
  explorerUrl: string | null
}

export type OwlCenterConfirmFail = {
  ok: false
  httpStatus: number
  code?: string
  message: string
}

export type OwlCenterConfirmResult = OwlCenterConfirmOkInserted | OwlCenterConfirmOkDuplicate | OwlCenterConfirmFail

function verifyTreasuryPayment(params: {
  parsed: ParsedTransactionWithMeta
  buyerWallet: string
  treasuryWallet: string
  expectLamports: bigint
}): boolean {
  return verifyOwlCenterTreasuryPayment(params)
}

function getVerifiedBreakdownForQuantity(
  cfg: OwlCenterPresaleCampaignConfig,
  buyerNorm: string,
  parsed: ParsedTransactionWithMeta,
  qty: number
): OwlCenterPriceBreakdown | null {
  const breakdown = computeOwlCenterPurchaseLamports(cfg, qty)
  const ok = verifyTreasuryPayment({
    parsed,
    buyerWallet: buyerNorm,
    treasuryWallet: cfg.treasuryWallet.toBase58(),
    expectLamports: breakdown.treasuryLamports,
  })
  if (ok) return breakdown

  const total = breakdown.totalLamports
  const impliedSolUsd = (cfg.priceUsdc * qty) / (Number(total) / LAMPORTS_PER_SOL)
  if (!Number.isFinite(impliedSolUsd) || impliedSolUsd <= 0) return null
  const altCfg = { ...cfg, solUsdPrice: impliedSolUsd }
  const altBreakdown = computeOwlCenterPurchaseLamports(altCfg, qty)
  const altOk = verifyTreasuryPayment({
    parsed,
    buyerWallet: buyerNorm,
    treasuryWallet: cfg.treasuryWallet.toBase58(),
    expectLamports: altBreakdown.treasuryLamports,
  })
  if (altOk) return altBreakdown
  return null
}

export async function executeOwlCenterPresaleConfirm(params: {
  tenant: OwlCenterPresaleTenantAdmin
  buyerWallet: string
  quantity: number
  txSignature: string
  solUsdPriceUsed?: number
  parsedTx?: ParsedTransactionWithMeta | null
}): Promise<OwlCenterConfirmResult> {
  const buyerNorm = normalizeSolanaWalletAddress(params.buyerWallet)
  if (!buyerNorm) {
    return { ok: false, httpStatus: 400, message: 'Invalid buyer wallet' }
  }

  const qty = params.quantity
  const quantityCap = params.tenant.max_spots_per_purchase
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > quantityCap) {
    return {
      ok: false,
      httpStatus: 400,
      message: `quantity must be an integer from 1 to ${quantityCap}`,
    }
  }

  if (!params.tenant.is_enabled) {
    return { ok: false, httpStatus: 403, code: 'tenant_disabled', message: 'Presale is not available.' }
  }

  if (!params.tenant.is_live) {
    return { ok: false, httpStatus: 403, code: 'presale_not_live', message: 'Presale is not live yet.' }
  }

  const balBefore = await getOwlCenterPresaleBalanceByWallet(params.tenant.id, buyerNorm)
  const creditsBefore = owlCenterPresaleTotalCreditsOnWallet(balBefore)
  if (creditsBefore + qty > params.tenant.max_credits_per_wallet) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'wallet_cap',
      message: `Each wallet can hold at most ${params.tenant.max_credits_per_wallet} presale credits.`,
    }
  }

  let cfg: OwlCenterPresaleCampaignConfig
  try {
    cfg = await getOwlCenterPresaleServerConfig(
      params.tenant,
      params.solUsdPriceUsed != null && params.solUsdPriceUsed > 0 ? params.solUsdPriceUsed : undefined
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server configuration error'
    return { ok: false, httpStatus: 500, message: msg }
  }

  const soldBefore = await sumOwlCenterPresaleSold(params.tenant.id)
  const remainingBefore = cfg.presaleSupply - soldBefore
  if (remainingBefore <= 0) {
    return { ok: false, httpStatus: 409, code: 'sold_out', message: 'Presale sold out' }
  }
  if (qty > remainingBefore) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'insufficient_supply',
      message: `Only ${remainingBefore} presale spots remaining`,
    }
  }

  const buyerPk = new PublicKey(buyerNorm)
  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  const parsed =
    params.parsedTx ?? (await fetchParsedTransactionConfirmed(connection, params.txSignature))
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
      message: 'Could not verify treasury payment in this transaction',
    }
  }

  const db = getSupabaseAdmin()
  const { data: rpcResult, error: rpcError } = await db.rpc('confirm_owl_center_presale_purchase', {
    p_tenant_id: params.tenant.id,
    p_wallet: buyerNorm,
    p_quantity: qty,
    p_unit_price_usdc: cfg.priceUsdc,
    p_sol_usd_price: breakdown.solUsdPrice,
    p_total_lamports: bigintToRpcParam(breakdown.totalLamports),
    p_treasury_lamports: bigintToRpcParam(breakdown.treasuryLamports),
    p_tx_signature: params.txSignature,
    p_presale_supply: cfg.presaleSupply,
    p_max_credits_per_wallet: cfg.maxCreditsPerWallet,
  })

  if (rpcError) {
    console.error('confirm_owl_center_presale_purchase RPC:', rpcError.message)
    return { ok: false, httpStatus: 500, code: 'db_error', message: 'Database error' }
  }

  const result = rpcResult as { ok?: boolean; error?: string } | null
  if (result?.ok === false) {
    if (result.error === 'duplicate_tx') {
      const dupBalance = await getOwlCenterPresaleBalanceByWallet(params.tenant.id, buyerNorm)
      const soldDup = await sumOwlCenterPresaleSold(params.tenant.id)
      const remainingDup = Math.max(0, params.tenant.presale_supply - soldDup)
      return {
        ok: true,
        inserted: false,
        reason: 'duplicate_tx',
        txSignature: params.txSignature,
        buyerWallet: buyerNorm,
        balance:
          dupBalance ?? {
            tenant_id: params.tenant.id,
            wallet: buyerNorm,
            purchased_mints: 0,
            gifted_mints: 0,
            used_mints: 0,
            available_mints: 0,
          },
        stats: {
          presale_supply: params.tenant.presale_supply,
          sold: soldDup,
          remaining: remainingDup,
          percent_sold: params.tenant.presale_supply > 0 ? (soldDup / params.tenant.presale_supply) * 100 : 0,
        },
        explorerUrl: gen2PresaleExplorerTxUrl(params.txSignature),
      }
    }
    if (result.error === 'wallet_cap') {
      return {
        ok: false,
        httpStatus: 409,
        code: 'wallet_cap',
        message: `Each wallet can hold at most ${params.tenant.max_credits_per_wallet} presale credits.`,
      }
    }
    if (result.error === 'sold_out') {
      return { ok: false, httpStatus: 409, code: 'sold_out', message: 'Presale sold out' }
    }
    if (result.error === 'tenant_disabled') {
      return { ok: false, httpStatus: 403, code: 'tenant_disabled', message: 'Presale is not available.' }
    }
  }

  const balance = await getOwlCenterPresaleBalanceByWallet(params.tenant.id, buyerNorm)
  const sold = await sumOwlCenterPresaleSold(params.tenant.id)
  const remaining = Math.max(0, params.tenant.presale_supply - sold)

  return {
    ok: true,
    inserted: true,
    txSignature: params.txSignature,
    buyerWallet: buyerNorm,
    quantity: qty,
    balance:
      balance ?? {
        tenant_id: params.tenant.id,
        wallet: buyerNorm,
        purchased_mints: qty,
        gifted_mints: 0,
        used_mints: 0,
        available_mints: qty,
      },
    stats: {
      presale_supply: params.tenant.presale_supply,
      sold,
      remaining,
      percent_sold: params.tenant.presale_supply > 0 ? (sold / params.tenant.presale_supply) * 100 : 0,
    },
    explorerUrl: gen2PresaleExplorerTxUrl(params.txSignature),
  }
}

export { lamportsPerSpot }
