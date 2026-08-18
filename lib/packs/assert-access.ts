import { NextResponse } from 'next/server'
import { isOwlVisionAdmin } from '@/lib/admin/access'
import { canAccessPacks, isPacksPublic } from '@/lib/packs/access'

/**
 * Server-side gate for packs APIs. Public by default; when the kill switch is off,
 * buyer/session wallet must be an admin.
 */
export async function assertPacksAccess(wallet: string): Promise<true | NextResponse> {
  if (isPacksPublic()) return true
  const admin = await isOwlVisionAdmin(wallet)
  if (canAccessPacks({ isAdmin: admin })) return true
  return NextResponse.json(
    { error: 'Owl Packs is currently unavailable.' },
    { status: 403 }
  )
}
