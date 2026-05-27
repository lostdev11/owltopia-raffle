import { NextRequest, NextResponse } from 'next/server'

import { parseWalletUploadText } from '@/lib/admin/parse-wallet-upload'
import { bulkUpsertPresaleOverageAllocations } from '@/lib/db/gen2-presale-overage'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** POST — bulk upload Presale+13 overage wallets. Body: { text, default_allowed_mints? } */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  const rl = rateLimit(`overage-bulk:${session.wallet}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string
      default_allowed_mints?: number
    }
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) {
      return NextResponse.json({ error: 'text is required (wallets list or CSV)' }, { status: 400 })
    }

    const defaultAllowed =
      body.default_allowed_mints != null && Number.isFinite(body.default_allowed_mints)
        ? Math.max(0, Math.floor(body.default_allowed_mints))
        : 1

    const parsed = parseWalletUploadText(text, { defaultAllowedMints: defaultAllowed, maxRows: 50 })
    if (!parsed.rows.length) {
      return NextResponse.json(
        { error: 'No valid wallets parsed', parse_errors: parsed.errors },
        { status: 400 }
      )
    }

    const rows = parsed.rows.map((r) => ({
      wallet: r.wallet,
      allowed_mints: r.allowed_mints,
      note: r.note,
    }))

    const result = await bulkUpsertPresaleOverageAllocations(rows)

    console.info('[admin/presale-overage/bulk]', {
      admin: session.wallet,
      upserted: result.upserted,
      failed: result.failed.length,
    })

    return NextResponse.json({
      ok: true,
      parsed: parsed.rows.length,
      skipped_duplicates: parsed.skipped_duplicates,
      parse_errors: parsed.errors,
      ...result,
    })
  } catch (e) {
    console.error('[admin/presale-overage/bulk POST]', e)
    return NextResponse.json({ error: 'Bulk upload failed' }, { status: 500 })
  }
}
