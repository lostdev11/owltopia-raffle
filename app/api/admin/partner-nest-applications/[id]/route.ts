import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  approvePartnerNestApplication,
  updatePartnerNestApplicationStatus,
  type PartnerNestRewardMode,
} from '@/lib/db/partner-nest-applications'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set(['new', 'contacted', 'active', 'closed'])

/**
 * PATCH /api/admin/partner-nest-applications/[id]
 * Body: { approve: true, reward_mode?: 'platform_owl' | 'partner_token' }
 *    or { status: 'closed' | 'contacted' | ..., rejection_reason? }
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const params = await context.params
    const id = Number.parseInt(params.id, 10)
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      status?: string
      approve?: boolean
      reward_mode?: string
      rejection_reason?: string
    }
    const approve = body.approve === true
    const status = typeof body.status === 'string' ? body.status.trim() : ''

    if (approve || status === 'active') {
      const rewardModeRaw = typeof body.reward_mode === 'string' ? body.reward_mode.trim() : ''
      const reward_mode: PartnerNestRewardMode | undefined =
        rewardModeRaw === 'partner_token'
          ? 'partner_token'
          : rewardModeRaw === 'platform_owl'
            ? 'platform_owl'
            : undefined

      const result = await approvePartnerNestApplication({
        id,
        reviewed_by: session.wallet,
        reward_mode,
      })
      return NextResponse.json({
        application: result.application,
        pool: result.pool,
        provisioned: true,
      })
    }

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const updated = await updatePartnerNestApplicationStatus(
      id,
      status as 'new' | 'contacted' | 'active' | 'closed',
      {
        rejection_reason:
          status === 'closed' && typeof body.rejection_reason === 'string'
            ? body.rejection_reason
            : status === 'closed'
              ? 'Rejected by admin'
              : undefined,
        reviewed_by: session.wallet,
      }
    )
    return NextResponse.json({ application: updated, provisioned: false })
  } catch (e) {
    console.error('[admin/partner-nest-applications PATCH]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    if (
      msg.toLowerCase().includes('cannot approve') ||
      msg.toLowerCase().includes('missing') ||
      msg.toLowerCase().includes('inactive') ||
      msg.toLowerCase().includes('required') ||
      msg.toLowerCase().includes('must')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
