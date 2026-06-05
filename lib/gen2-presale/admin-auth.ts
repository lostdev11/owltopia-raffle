import { NextRequest, NextResponse } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { requireSession } from '@/lib/auth-server'

/** Full admin (DB) or comma-separated `ADMIN_WALLETS` env (base58). */
export async function isGen2PresaleAdmin(wallet: string): Promise<boolean> {
  return isOwlVisionAdmin(wallet)
}

export async function requireGen2PresaleAdminSession(
  request: NextRequest
): Promise<{ wallet: string } | NextResponse> {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  const ok = await isGen2PresaleAdmin(session.wallet)
  if (!ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}
