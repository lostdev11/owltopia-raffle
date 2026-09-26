import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession, requireFullAdminSession } from '@/lib/auth-server'
import { deleteAdminOpsLog, updateAdminOpsLog } from '@/lib/db/admin-ops-log'
import { parseUpdateAdminOpsLogBody } from '@/lib/admin-ops-log/parse-body'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/ops-log/[id] — update entry (mod + full).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await params
    if (!id?.trim()) {
      return NextResponse.json({ error: 'Entry id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-patch:${ip}:${session.wallet}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = parseUpdateAdminOpsLogBody(body, session.wallet)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const entry = await updateAdminOpsLog(id, parsed.params)
    if (!entry) {
      return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 })
    }
    return NextResponse.json({ entry })
  } catch (e) {
    console.error('[admin/ops-log PATCH]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/ops-log/[id] — full admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await params
    if (!id?.trim()) {
      return NextResponse.json({ error: 'Entry id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-delete:${ip}:${session.wallet}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const ok = await deleteAdminOpsLog(id)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[admin/ops-log DELETE]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
