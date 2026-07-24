import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions } from '@/lib/auctions/access'
import { isAdmin } from '@/lib/db/admins'

export const dynamic = 'force-dynamic'

/** GET /api/auctions/access — whether the signed-in wallet may browse/create partner auctions. */
export async function GET(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  const allowed = await canAccessPartnerAuctions(session.wallet)
  const admin = allowed ? await isAdmin(session.wallet) : false
  return NextResponse.json({
    ok: true,
    wallet: session.wallet,
    allowed,
    isAdmin: admin,
  })
}
