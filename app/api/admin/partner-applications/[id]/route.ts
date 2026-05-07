import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { updatePartnerProgramApplicationStatus } from '@/lib/db/partner-program-applications'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set(['new', 'contacted', 'active', 'closed'])

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = Number.parseInt(params.id, 10)
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { status?: string }
    const status = typeof body.status === 'string' ? body.status.trim() : ''
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const updated = await updatePartnerProgramApplicationStatus(
      id,
      status as 'new' | 'contacted' | 'active' | 'closed'
    )
    return NextResponse.json({ application: updated })
  } catch (error) {
    console.error('[PATCH /api/admin/partner-applications/:id]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
