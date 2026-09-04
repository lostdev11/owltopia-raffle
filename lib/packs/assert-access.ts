import { NextResponse } from 'next/server'
import { isOwlVisionAdmin } from '@/lib/admin/access'
import { isWalletOnPackTestAllowlist } from '@/lib/db/pack-test-wallets'
import { resolvePackAccess } from '@/lib/packs/access'

/**
 * Server-side gate for packs APIs.
 * Public mode → anyone. Restricted → admin or test allowlist.
 * Env kill switch → admins only.
 */
export async function assertPacksAccess(wallet: string): Promise<true | NextResponse> {
  const admin = await isOwlVisionAdmin(wallet)
  const isTester = admin ? false : await isWalletOnPackTestAllowlist(wallet)
  const { allowed } = await resolvePackAccess({ isAdmin: admin, isTester })
  if (allowed) return true
  return NextResponse.json(
    { error: 'Owl Packs is currently unavailable.' },
    { status: 403 }
  )
}
