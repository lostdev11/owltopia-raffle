import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { isGen2PresaleAdmin } from '@/lib/gen2-presale/admin-auth'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/**
 * Milestones may be managed by a full admin OR the launch's creator/owner.
 * For gen2 this is effectively admin-only, but this also supports future
 * creator-run launches without a rewrite.
 */
export async function requireGen2MilestoneManager(
  request: NextRequest,
  launch: Pick<OwlCenterLaunchPublic, 'creator_wallet'>
): Promise<{ wallet: string } | NextResponse> {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  const isAdmin = await isGen2PresaleAdmin(session.wallet)
  const creator = (launch.creator_wallet || '').trim()
  const isCreator = !!creator && walletsEqualSolana(creator, session.wallet)

  if (!isAdmin && !isCreator) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}
