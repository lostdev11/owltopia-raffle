import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getSessionFromRequest } from '@/lib/auth-server'
import { getOwlCenterLaunchAccess } from '@/lib/owl-center/launch-access'

export type GeneratorStageSession = {
  wallet: string
  isAdmin: boolean
  isPartner: boolean
}

export async function requireGeneratorStageSession(
  request: NextRequest
): Promise<GeneratorStageSession | NextResponse> {
  const session = getSessionFromRequest(request)
  if (!session?.wallet) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const access = await getOwlCenterLaunchAccess(request)
  if (!access) {
    return NextResponse.json({ error: 'Approved partner or admin access required' }, { status: 403 })
  }

  return { wallet: access.wallet, isAdmin: access.isAdmin, isPartner: access.isPartner }
}
