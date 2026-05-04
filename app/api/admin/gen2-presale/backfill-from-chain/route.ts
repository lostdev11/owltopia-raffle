import { Connection, type ConfirmedSignatureInfo } from '@solana/web3.js'
import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { executeGen2PresaleConfirmWithQuantitySearch } from '@/lib/gen2-presale/confirm-core'
import { getGen2PresaleServerConfig } from '@/lib/gen2-presale/config'
import {
  fetchParsedTransactionConfirmed,
  getFeePayerPublicKey,
} from '@/lib/gen2-presale/verify-payment'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_SIGNATURES = 100
const DEFAULT_SIGNATURES = 50

function mergeFounderSignatureLists(
  a: ConfirmedSignatureInfo[],
  b: ConfirmedSignatureInfo[],
  limit: number
): ConfirmedSignatureInfo[] {
  const merged = new Map<string, ConfirmedSignatureInfo>()
  for (const info of [...a, ...b]) {
    const prev = merged.get(info.signature)
    if (!prev || (info.blockTime ?? 0) > (prev.blockTime ?? 0)) {
      merged.set(info.signature, info)
    }
  }
  return [...merged.values()]
    .sort((x, y) => (y.blockTime ?? 0) - (x.blockTime ?? 0))
    .slice(0, limit)
}

/**
 * Scan recent transactions touching a founder wallet, attempt to record any Gen2 presale payment
 * that is on-chain but missing from `gen2_presale_purchases` (e.g. confirm never ran after signing).
 */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  const rl = rateLimit(`gen2-backfill-chain:${ip}`, 8, 120_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many backfill requests — wait two minutes.' }, { status: 429 })
  }

  let body: { signatureLimit?: number; founder?: 'a' | 'b' | 'both' }
  try {
    body = (await request.json().catch(() => ({}))) as typeof body
  } catch {
    body = {}
  }

  const signatureLimit = Math.min(
    MAX_SIGNATURES,
    Math.max(1, Math.floor(Number(body.signatureLimit) || DEFAULT_SIGNATURES))
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
  if (founderScope === 'both') {
    const [a, b] = await Promise.all([
      connection.getSignaturesForAddress(cfg.founderA, { limit: signatureLimit }),
      connection.getSignaturesForAddress(cfg.founderB, { limit: signatureLimit }),
    ])
    sigInfos = mergeFounderSignatureLists(a, b, signatureLimit)
  } else {
    const founderPk = founderScope === 'b' ? cfg.founderB : cfg.founderA
    sigInfos = await connection.getSignaturesForAddress(founderPk, { limit: signatureLimit })
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
    founder_wallets_scanned:
      founderScope === 'both'
        ? [cfg.founderA.toBase58(), cfg.founderB.toBase58()]
        : [(founderScope === 'b' ? cfg.founderB : cfg.founderA).toBase58()],
    signature_limit: signatureLimit,
    summary,
    inserted,
    errors,
  })
}
