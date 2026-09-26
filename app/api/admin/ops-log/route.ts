import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { createAdminOpsLog, listAdminOpsLog } from '@/lib/db/admin-ops-log'
import { parseCreateAdminOpsLogBody, parseListAdminOpsLogQuery } from '@/lib/admin-ops-log/parse-body'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/ops-log — list entries (mod + full). Filters: type, status, search; paginated.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-list:${ip}:${session.wallet}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const q = parseListAdminOpsLogQuery(request.nextUrl.searchParams)
    const { rows, total } = await listAdminOpsLog(q)
    return NextResponse.json({ entries: rows, total, limit: q.limit, offset: q.offset })
  } catch (e) {
    console.error('[admin/ops-log GET]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('admin_ops_log') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Table missing. Run migration 250_admin_ops_log.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/ops-log — create entry (mod + full).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-create:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = parseCreateAdminOpsLogBody(body, session.wallet)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const entry = await createAdminOpsLog(parsed.params)
    if (!entry) {
      return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 })
    }
    return NextResponse.json({ entry })
  } catch (e) {
    console.error('[admin/ops-log POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
