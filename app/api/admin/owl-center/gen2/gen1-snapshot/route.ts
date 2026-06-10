import { NextRequest, NextResponse } from 'next/server'

import { parseWalletUploadText } from '@/lib/admin/parse-wallet-upload'
import {
  bulkUpsertGen1Snapshot,
  getGen1SnapshotSummary,
  replaceGen1Snapshot,
} from '@/lib/db/gen2-gen1-snapshot'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { scanGen1HoldersFromChain } from '@/lib/owl-center/gen1-holder-scan'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Gen1 holder snapshot for the Gen2 AIRDROP allowList guard (migration 142).
 *
 * GET  — snapshot summary (wallet count, total NFTs, last update).
 * POST — populate the snapshot, then fetch the merkle root from
 *        /api/owl-center/gen2/wl-proof?phase=AIRDROP and set it on the `gen1` guard group.
 *   { mode: 'chain', replace?: true }          — scan current holders on-chain (Helius DAS).
 *   { mode: 'csv', text, replace?: true }      — paste wallets / CSV (`wallet,count` — count defaults 1).
 *
 * `replace: true` wipes the previous snapshot first (use for a clean snapshot before launch);
 * otherwise rows are upserted into the existing snapshot.
 */

export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const summary = await getGen1SnapshotSummary()
  return NextResponse.json(summary)
}

export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const rl = rateLimit(`gen1-snapshot:${session.wallet}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string
      text?: string
      replace?: boolean
    }
    const replace = body.replace === true

    if (body.mode === 'chain') {
      const scan = await scanGen1HoldersFromChain()
      if (!scan.ok) {
        return NextResponse.json({ error: scan.error }, { status: 502 })
      }
      const result = replace
        ? await replaceGen1Snapshot(scan.holders, 'chain')
        : await bulkUpsertGen1Snapshot(scan.holders, 'chain')

      console.info('[admin/gen1-snapshot] chain scan', {
        admin: session.wallet,
        holders: scan.holders.length,
        assets: scan.assets_scanned,
        upserted: result.upserted,
        failed: result.failed.length,
        replace,
      })
      return NextResponse.json({
        ok: true,
        mode: 'chain',
        replace,
        holders: scan.holders.length,
        assets_scanned: scan.assets_scanned,
        ...result,
        summary: await getGen1SnapshotSummary(),
      })
    }

    if (body.mode === 'csv') {
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim()) {
        return NextResponse.json({ error: 'text is required (wallets list or CSV)' }, { status: 400 })
      }
      const parsed = parseWalletUploadText(text, { defaultAllowedMints: 1 })
      const rows = parsed.rows
        .filter((r) => r.allowed_mints > 0)
        .map((r) => ({ wallet: r.wallet, gen1_nft_count: r.allowed_mints }))
      if (!rows.length) {
        return NextResponse.json(
          { error: 'No valid wallets parsed', parse_errors: parsed.errors },
          { status: 400 }
        )
      }

      const result = replace
        ? await replaceGen1Snapshot(rows, 'csv')
        : await bulkUpsertGen1Snapshot(rows, 'csv')

      console.info('[admin/gen1-snapshot] csv upload', {
        admin: session.wallet,
        parsed: rows.length,
        upserted: result.upserted,
        failed: result.failed.length,
        replace,
      })
      return NextResponse.json({
        ok: true,
        mode: 'csv',
        replace,
        parsed: rows.length,
        skipped_duplicates: parsed.skipped_duplicates,
        parse_errors: parsed.errors,
        ...result,
        summary: await getGen1SnapshotSummary(),
      })
    }

    return NextResponse.json({ error: "mode must be 'chain' or 'csv'" }, { status: 400 })
  } catch (e) {
    console.error('[admin/gen1-snapshot POST]', e)
    return NextResponse.json({ error: 'Gen1 snapshot update failed' }, { status: 500 })
  }
}
