import { Connection, type ConfirmedSignatureInfo } from '@solana/web3.js'
import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { executeGen2PresaleConfirmWithQuantitySearch } from '@/lib/gen2-presale/confirm-core'
import { fetchSignaturesForAddressPaginated } from '@/lib/gen2-presale/fetch-signatures-paginated'
import { getGen2PresaleServerConfig } from '@/lib/gen2-presale/config'
import {
  fetchParsedTransactionConfirmed,
  getFeePayerPublicKey,
} from '@/lib/gen2-presale/verify-payment'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Solana RPC allows up to 1000 signatures per `getSignaturesForAddress` call. */
const PAGE_SIZE_MAX = 1000
const PAGE_SIZE_DEFAULT = 100
const MAX_PAGES_DEFAULT = 25
const MAX_PAGES_CAP = 80

/**
 * Scan transactions touching a founder wallet (paginated), attempt to record Gen2 presale payments
 * missing from `gen2_presale_purchases`. Each presale pays both founders; scanning founder A alone
 * with deep pagination finds all presales without losing old txs under a shallow “top N” merge.
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

  /** When `both`, follow founder A only — every presale tx credits founder A (and B). */
  const scanPk =
    founderScope === 'b' ? cfg.founderB : founderScope === 'a' ? cfg.founderA : cfg.founderA

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  let sigInfos: ConfirmedSignatureInfo[]
  let pagesFetched: number
  try {
    const res = await fetchSignaturesForAddressPaginated(connection, scanPk, pageSize, maxPages)
    sigInfos = res.signatures
    pagesFetched = res.pagesFetched
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'RPC failed listing signatures'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const db = getSupabaseAdmin()
  const summary = {
    scanned: 0,
    skipped_already_recorded: 0,
    skipped_signature_failed_on_chain: 0,
    skipped_no_parsed_tx: 0,
    skipped_no_fee_payer: 0,
    inserted: 0,
    duplicate_rpc: 0,
    no_presale_match: 0,
    other_errors: 0,
  }

  const inserted: { signature: string; buyer: string; quantity: number }[] = []
  const errors: { signature: string; code?: string; message: string }[] = []

  for (const info of sigInfos) {
    if (info.err) {
      summary.skipped_signature_failed_on_chain++
      continue
    }

    const sig = info.signature

    const { data: existing } = await db
      .from('gen2_presale_purchases')
      .select('tx_signature')
      .eq('tx_signature', sig)
      .maybeSingle()
    if (existing) {
      summary.skipped_already_recorded++
      continue
    }

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
      continue
    }

    summary.other_errors++
    if (errors.length < 40) {
      errors.push({ signature: sig, code: r.code, message: r.message })
    }
  }

  return NextResponse.json({
    ok: true,
    founder_scope: founderScope,
    scan_note:
      founderScope === 'both'
        ? 'Paginated founder A only; each presale pays founder A and B, so this covers all presale signatures.'
        : undefined,
    founder_wallets_scanned: [scanPk.toBase58()],
    pagination: {
      page_size: pageSize,
      max_pages: maxPages,
      pages_fetched: pagesFetched,
      signatures_fetched: sigInfos.length,
    },
    summary,
    inserted,
    errors,
  })
}
