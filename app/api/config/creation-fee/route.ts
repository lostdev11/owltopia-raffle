import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-server'
import { isAdmin } from '@/lib/db/admins'
import { getCreationFeeConfig } from '@/lib/creation-fee'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/creation-fee
 * Returns whether the current user is admin (exempt from fee) and creation fee amount/recipient.
 * Uses session cookie when present. Used by Create Raffle form to show fee step for non-admins.
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request)
    const admin = session ? await isAdmin(session.wallet) : false
    const { creationFeeLamports, creationFeeRecipient, creationFeeRequired } = getCreationFeeConfig()

    return NextResponse.json({
      isAdmin: admin,
      creationFeeLamports,
      creationFeeRecipient,
      creationFeeRequired: !admin && creationFeeRequired,
    })
  } catch {
    return NextResponse.json(
      { creationFeeLamports: 0, creationFeeRecipient: null, isAdmin: false, creationFeeRequired: false },
      { status: 200 }
    )
  }
}
