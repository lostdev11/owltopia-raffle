import { NextRequest, NextResponse } from 'next/server'

import { parseWalletUploadText } from '@/lib/admin/parse-wallet-upload'
import { bulkUpsertWlAllocations, listWlAllocations } from '@/lib/db/owl-center-wl-allocations'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** GET — list WL allocations (admin). */
export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 500
    const rows = await listWlAllocations(limit)
    return NextResponse.json({ rows })
  } catch (e) {
    console.error('[admin/wl-allocations GET]', e)
    return NextResponse.json({ error: 'Failed to load WL allocations' }, { status: 500 })
  }
}

/** POST — bulk upload wallets. Body: { text, default_allowed_mints?, community? } */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  const rl = rateLimit(`wl-bulk:${session.wallet}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string
      default_allowed_mints?: number
      community?: string
    }
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) {
      return NextResponse.json({ error: 'text is required (wallets list or CSV)' }, { status: 400 })
    }

    const defaultAllowed =
      body.default_allowed_mints != null && Number.isFinite(body.default_allowed_mints)
        ? Math.max(0, Math.floor(body.default_allowed_mints))
        : 1
    const defaultCommunity = typeof body.community === 'string' ? body.community.trim() || null : null

    const parsed = parseWalletUploadText(text, { defaultAllowedMints: defaultAllowed })
    if (!parsed.rows.length) {
      return NextResponse.json(
        { error: 'No valid wallets parsed', parse_errors: parsed.errors },
        { status: 400 }
      )
    }

    const rows = parsed.rows.map((r) => ({
      wallet: r.wallet,
      allowed_mints: r.allowed_mints,
      community: r.community ?? defaultCommunity,
    }))

    const result = await bulkUpsertWlAllocations(rows)

    console.info('[admin/wl-allocations/bulk]', {
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
    console.error('[admin/wl-allocations/bulk POST]', e)
    return NextResponse.json({ error: 'Bulk upload failed' }, { status: 500 })
  }
}
