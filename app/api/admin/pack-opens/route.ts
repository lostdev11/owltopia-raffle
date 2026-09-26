import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { parseListAdminPackOpensQuery } from '@/lib/admin-pack-opens/parse-query'
import {
  getAdminPackOpenById,
  listAdminPackOpens,
  listAdminPackOpenProducts,
} from '@/lib/db/admin-pack-opens'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/pack-opens — read-only pack open ledger (mod + full).
 * Query: wallet, wallet_mode=prefix|exact, status (comma-separated), product_id,
 * created_from, created_to, stuck=1, limit, offset.
 * Optional meta=products returns product filter options.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-pack-opens-list:${ip}:${session.wallet}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const searchParams = request.nextUrl.searchParams
    const openId = searchParams.get('id')?.trim()
    if (openId) {
      const open = await getAdminPackOpenById(openId)
      if (!open) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ open })
    }

    if (searchParams.get('meta') === 'products') {
      const products = await listAdminPackOpenProducts()
      return NextResponse.json({ products })
    }

    const q = parseListAdminPackOpensQuery(searchParams)
    const { rows, total } = await listAdminPackOpens(q)
    return NextResponse.json({ opens: rows, total, limit: q.limit, offset: q.offset })
  } catch (e) {
    console.error('[admin/pack-opens GET]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('pack_opens') || msg.includes('does not exist')) {
      return NextResponse.json({ error: 'pack_opens table unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
