import { NextRequest, NextResponse } from 'next/server'
import { getOwlVisionAdminRole } from '@/lib/admin/access'
import { isModOrAboveRole } from '@/lib/admin/roles'
import { buildAdminActionInbox } from '@/lib/admin/action-inbox'
import { requireSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/action-inbox
 * Mod or full: unresolved platform actions for Owl Vision terminal inbox.
 * Financial/irreversible items are view-only for mods (links escalate to full-admin pages).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const role = await getOwlVisionAdminRole(session.wallet)
    if (!isModOrAboveRole(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const items = await buildAdminActionInbox()
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      items,
      total: items.length,
      role,
    })
  } catch (err) {
    console.error('[GET /api/admin/action-inbox]', err)
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 })
  }
}
