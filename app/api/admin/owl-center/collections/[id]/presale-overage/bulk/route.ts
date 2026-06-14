import { NextRequest, NextResponse } from 'next/server'

import { parseWalletUploadText } from '@/lib/admin/parse-wallet-upload'
import { bulkUpsertLaunchPresaleOverageAllocations } from '@/lib/db/owl-center-presale-overage'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { launchHasPresaleProgram } from '@/lib/owl-center/launch-presale'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`launch-overage-bulk:${session.wallet}`, 20, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid launch id' }, { status: 400 })

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  if (launch.slug === 'gen2') {
    return NextResponse.json({ error: 'Use Gen2 admin for Gen2 presale overage' }, { status: 400 })
  }
  if (!launchHasPresaleProgram(launch)) {
    return NextResponse.json({ error: 'Enable presale on this launch first' }, { status: 400 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { text?: string; default_allowed_mints?: number }
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) return NextResponse.json({ error: 'text is required (wallets list or CSV)' }, { status: 400 })

    const defaultAllowed =
      body.default_allowed_mints != null && Number.isFinite(body.default_allowed_mints)
        ? Math.max(0, Math.floor(body.default_allowed_mints))
        : 1

    const parsed = parseWalletUploadText(text, { defaultAllowedMints: defaultAllowed, maxRows: 200 })
    if (!parsed.rows.length) {
      return NextResponse.json({ error: 'No valid wallets parsed', parse_errors: parsed.errors }, { status: 400 })
    }

    const result = await bulkUpsertLaunchPresaleOverageAllocations(
      id,
      parsed.rows.map((r) => ({ wallet: r.wallet, allowed_mints: r.allowed_mints, note: r.note }))
    )

    return NextResponse.json({
      ok: true,
      parsed: parsed.rows.length,
      skipped_duplicates: parsed.skipped_duplicates,
      parse_errors: parsed.errors,
      ...result,
    })
  } catch (e) {
    console.error('[admin/collections/presale-overage/bulk POST]', e)
    return NextResponse.json({ error: 'Bulk upload failed' }, { status: 500 })
  }
}
