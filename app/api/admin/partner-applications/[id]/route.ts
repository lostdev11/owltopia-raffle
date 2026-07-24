import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  approvePartnerProgramApplication,
  updatePartnerProgramApplicationStatus,
} from '@/lib/db/partner-program-applications'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set(['new', 'contacted', 'active', 'closed'])

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = Number.parseInt(params.id, 10)
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { status?: string; approve?: boolean }
    const approve = body.approve === true
    const status = typeof body.status === 'string' ? body.status.trim() : ''

    if (approve || status === 'active') {
      const result = await approvePartnerProgramApplication(id)
      return NextResponse.json({
        application: result.application,
        creator_wallet: result.creator_wallet,
        provisioned: true,
      })
    }

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const updated = await updatePartnerProgramApplicationStatus(
      id,
      status as 'new' | 'contacted' | 'active' | 'closed'
    )
    return NextResponse.json({ application: updated, provisioned: false })
  } catch (error) {
    console.error('[PATCH /api/admin/partner-applications/:id]', error)
    const msg = safeErrorMessage(error)
    if (msg.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    if (msg.toLowerCase().includes('valid solana')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
