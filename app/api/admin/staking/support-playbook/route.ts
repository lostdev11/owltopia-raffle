import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { loadAdminSupportPlaybook } from '@/lib/nesting/admin-support-playbook'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/admin/staking/support-playbook?wallet=<address>
 * Combined claim-ledger audit + nest diagnostics (Owltopia coins + Gen 1 + Gen 2)
 * with do-not-harm guards for catch-up vs wallet heal.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet query param is required' }, { status: 400 })
    }

    const playbook = await loadAdminSupportPlaybook(wallet)
    return NextResponse.json(playbook)
  } catch (e) {
    console.error('[admin/staking/support-playbook]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
