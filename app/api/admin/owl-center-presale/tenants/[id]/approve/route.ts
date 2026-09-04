import { NextRequest, NextResponse } from 'next/server'

import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getOwlCenterPresaleTenantById,
  updateOwlCenterPresaleTenant,
} from '@/lib/db/owl-center-presale-tenants'
import { owlCenterPresalePublicPath } from '@/lib/owl-center-presale/slug'
import { sumOwlCenterPresaleSold } from '@/lib/owl-center-presale/db'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST — approve or reject a partner-submitted presale.
 * Body: { action: 'approve' | 'reject', rejection_reason?, go_live? }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await context.params
    const tenant = await getOwlCenterPresaleTenantById(id)
    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      rejection_reason?: string
      go_live?: boolean
    }
    const action = body.action === 'reject' ? 'reject' : body.action === 'approve' ? 'approve' : null
    if (!action) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
    }

    const actor = normalizeSolanaWalletAddress(session.wallet)

    if (action === 'reject') {
      const updated = await updateOwlCenterPresaleTenant(id, {
        approval_status: 'rejected',
        is_enabled: false,
        is_live: false,
        rejection_reason:
          typeof body.rejection_reason === 'string' && body.rejection_reason.trim()
            ? body.rejection_reason.trim().slice(0, 500)
            : 'Rejected by Owltopia admin',
        updated_by_wallet: actor,
      })
      return NextResponse.json({ tenant: updated })
    }

    const goLive = body.go_live === true
    const updated = await updateOwlCenterPresaleTenant(id, {
      approval_status: 'approved',
      rejection_reason: null,
      is_enabled: true,
      is_live: goLive,
      updated_by_wallet: actor,
    })
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let sold = 0
    try {
      sold = await sumOwlCenterPresaleSold(updated.id)
    } catch {
      sold = 0
    }

    return NextResponse.json({
      tenant: {
        ...updated,
        sold,
        remaining: Math.max(0, updated.presale_supply - sold),
        presale_url: owlCenterPresalePublicPath(updated.slug),
      },
    })
  } catch (error) {
    console.error('[admin/owl-center-presale approve]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
