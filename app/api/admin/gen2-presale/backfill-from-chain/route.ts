import { Connection, type ConfirmedSignatureInfo } from '@solana/web3.js'
import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import {
  executeGen2PresaleConfirmWithQuantitySearch,
  resolveGen2PresaleQuantityFromParsedTx,
} from '@/lib/gen2-presale/confirm-core'
import { fetchSignaturesForAddressPaginated } from '@/lib/gen2-presale/fetch-signatures-paginated'
import { getGen2PresaleServerConfig } from '@/lib/gen2-presale/config'
import { getGen2PresalePurchaseRowsBySignatures } from '@/lib/gen2-presale/db'
import { bigintToRpcParam } from '@/lib/gen2-presale/rpc-bigint'
import {
  fetchParsedTransactionConfirmed,
  getFeePayerPublicKey,
} from '@/lib/gen2-presale/verify-payment'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Solana RPC allows up to 1000 signatures per `getSignaturesForAddress` call. */
const PAGE_SIZE_MAX = 1000
const PAGE_SIZE_DEFAULT = 100
const MAX_PAGES_DEFAULT = 8
const MAX_PAGES_CAP = 80

/**
 * Each signature runs parsed tx + verification — inserts new rows and re-verifies existing rows so
 * under-reported quantities from an earlier backfill can be repaired.
 */
const MAX_DEEP_VERIFICATIONS_PER_REQUEST = 150

function mergeFounderSignatureLists(
  a: ConfirmedSignatureInfo[],
  b: ConfirmedSignatureInfo[]
): ConfirmedSignatureInfo[] {
  const merged = new Map<string, ConfirmedSignatureInfo>()
  for (const info of [...a, ...b]) {
    const prev = merged.get(info.signature)
    if (!prev || (info.blockTime ?? 0) > (prev.blockTime ?? 0)) {
      merged.set(info.signature, info)
    }
  }
  return [...merged.values()].sort((x, y) => (y.blockTime ?? 0) - (x.blockTime ?? 0))
}

/**
 * Scan transactions touching founder wallet(s) (paginated). Inserts missing purchases and re-verifies
 * existing rows against chain so missed credits from a bad first backfill can be fixed.
 */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  const rl = rateLimit(`gen2-backfill-chain:${ip}`, 8, 120_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many backfill requests — wait two minutes.' }, { status: 429 })
  }

  let body: {
    signatureLimit?: number
    pageSize?: number
    maxPages?: number
    founder?: 'a' | 'b' | 'both'
  }
  try {
    body = (await request.json().catch(() => ({}))) as typeof body
  } catch {
    body = {}
  }

  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Math.floor(Number(body.pageSize) || Number(body.signatureLimit) || PAGE_SIZE_DEFAULT))
  )
  const maxPages = Math.min(
    MAX_PAGES_CAP,
    Math.max(1, Math.floor(Number(body.maxPages) || MAX_PAGES_DEFAULT))
  )

  let cfg
  try {
    cfg = await getGen2PresaleServerConfig()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server configuration error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const founderScope: 'a' | 'b' | 'both' =
    body.founder === 'a' || body.founder === 'b' ? body.founder : 'both'

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  let sigInfos: ConfirmedSignatureInfo[]
  let pagesFetchedByWallet: { founder_a?: number; founder_b?: number }
  try {
    if (founderScope === 'both') {
      const [ra, rb] = await Promise.all([
        fetchSignaturesForAddressPaginated(connection, cfg.founderA, pageSize, maxPages),
        fetchSignaturesForAddressPaginated(connection, cfg.founderB, pageSize, maxPages),
      ])
      sigInfos = mergeFounderSignatureLists(ra.signatures, rb.signatures)
      pagesFetchedByWallet = { founder_a: ra.pagesFetched, founder_b: rb.pagesFetched }
    } else {
      const scanPk = founderScope === 'b' ? cfg.founderB : cfg.founderA
      const res = await fetchSignaturesForAddressPaginated(connection, scanPk, pageSize, maxPages)
      sigInfos = res.signatures
      pagesFetchedByWallet =
        founderScope === 'a' ? { founder_a: res.pagesFetched } : { founder_b: res.pagesFetched }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'RPC failed listing signatures'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const goodSigs = sigInfos.filter((i) => !i.err).map((i) => i.signature)
  let purchaseBySig: Map<string, { wallet: string; quantity: number }>
  try {
    purchaseBySig = await getGen2PresalePurchaseRowsBySignatures(goodSigs)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Database error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const summary = {
    scanned: 0,
    deferred_past_verification_cap: 0,
    skipped_signature_failed_on_chain: 0,
    skipped_no_parsed_tx: 0,
    skipped_no_fee_payer: 0,
    inserted: 0,
    duplicate_rpc: 0,
    no_presale_match: 0,
    existing_reverified_ok: 0,
    existing_repaired_quantity: 0,
    existing_reverify_failed: 0,
    existing_wallet_mismatch: 0,
    existing_chain_qty_lower_than_db: 0,
    repair_rpc_errors: 0,
    other_errors: 0,
  }

  const inserted: { signature: string; buyer: string; quantity: number }[] = []
  const repaired: { signature: string; buyer: string; previous_quantity: number; new_quantity: number }[] =
    []
  const errors: { signature: string; code?: string; message: string }[] = []
  /** Subset of signatures that looked like founder activity but failed presale verify (for debugging). */
  const no_presale_match_details: { signature: string; fee_payer: string; code?: string; message: string }[] =
    []

  const db = getSupabaseAdmin()
  let deepRuns = 0

  for (const info of sigInfos) {
    if (info.err) {
      summary.skipped_signature_failed_on_chain++
      continue
    }

    const sig = info.signature

    if (deepRuns >= MAX_DEEP_VERIFICATIONS_PER_REQUEST) {
      summary.deferred_past_verification_cap++
      continue
    }
    deepRuns++

    summary.scanned++

    const parsed = await fetchParsedTransactionConfirmed(connection, sig)
    if (!parsed || parsed.meta?.err) {
      summary.skipped_no_parsed_tx++
      continue
    }

    const fp = getFeePayerPublicKey(parsed)
    if (!fp) {
      summary.skipped_no_fee_payer++
      continue
    }
    const buyer = fp.toBase58()

    const stored = purchaseBySig.get(sig)

    if (!stored) {
      const r = await executeGen2PresaleConfirmWithQuantitySearch({
        buyerWallet: buyer,
        txSignature: sig,
        parsedTx: parsed,
      })

      if (r.ok) {
        if (r.inserted) {
          summary.inserted++
          inserted.push({ signature: sig, buyer, quantity: r.quantity })
        } else {
          summary.duplicate_rpc++
        }
        continue
      }

      if (r.code === 'payment_mismatch') {
        summary.no_presale_match++
        if (no_presale_match_details.length < 30) {
          no_presale_match_details.push({
            signature: sig,
            fee_payer: buyer,
            code: r.code,
            message: r.message,
          })
        }
        continue
      }

      summary.other_errors++
      if (errors.length < 40) {
        errors.push({ signature: sig, code: r.code, message: r.message })
      }
      continue
    }

    const resolved = await resolveGen2PresaleQuantityFromParsedTx({
      buyerWallet: buyer,
      parsedTx: parsed,
    })

    if (!resolved.ok) {
      summary.existing_reverify_failed++
      if (errors.length < 40) {
        errors.push({
          signature: sig,
          code: resolved.code,
          message: `existing row re-verify: ${resolved.message}`,
        })
      }
      continue
    }

    const storedWallet = normalizeSolanaWalletAddress(stored.wallet)
    if (!storedWallet || storedWallet !== resolved.buyerWallet) {
      summary.existing_wallet_mismatch++
      continue
    }

    if (resolved.quantity === stored.quantity) {
      summary.existing_reverified_ok++
      continue
    }

    if (resolved.quantity < stored.quantity) {
      summary.existing_chain_qty_lower_than_db++
      continue
    }

    const { data: rpcResult, error: rpcError } = await db.rpc('repair_gen2_presale_purchase_quantity', {
      p_tx_signature: sig,
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
      console.error('backfill repair_gen2_presale_purchase_quantity:', rpcError.message)
      summary.repair_rpc_errors++
      if (errors.length < 40) {
        errors.push({ signature: sig, code: 'repair_rpc', message: rpcError.message })
      }
      continue
    }

    const result = rpcResult as {
      ok?: boolean
      error?: string
      unchanged?: boolean
      previous_quantity?: number
      quantity?: number
    } | null

    if (result?.ok === false) {
      summary.repair_rpc_errors++
      if (errors.length < 40) {
        errors.push({
          signature: sig,
          code: result.error ?? 'repair_failed',
          message: String(result.error ?? 'repair failed'),
        })
      }
      continue
    }

    if (result?.unchanged) {
      summary.existing_reverified_ok++
      continue
    }

    summary.existing_repaired_quantity++
    repaired.push({
      signature: sig,
      buyer: resolved.buyerWallet,
      previous_quantity: stored.quantity,
      new_quantity: resolved.quantity,
    })
  }

  const founderWalletsScanned =
    founderScope === 'both'
      ? [cfg.founderA.toBase58(), cfg.founderB.toBase58()]
      : founderScope === 'b'
        ? [cfg.founderB.toBase58()]
        : [cfg.founderA.toBase58()]

  return NextResponse.json({
    ok: true,
    founder_scope: founderScope,
    scan_note:
      founderScope === 'both'
        ? 'Paginated founder A and founder B in parallel, merged unique signatures (newest first). Existing DB rows are re-verified; higher on-chain quantity repairs missing credits.'
        : undefined,
    founder_wallets_scanned: founderWalletsScanned,
    pagination: {
      page_size: pageSize,
      max_pages: maxPages,
      pages_fetched: pagesFetchedByWallet,
      signatures_fetched: sigInfos.length,
    },
    limits: {
      max_deep_verifications: MAX_DEEP_VERIFICATIONS_PER_REQUEST,
    },
    summary,
    inserted,
    repaired,
    errors,
    no_presale_match_details,
  })
}
