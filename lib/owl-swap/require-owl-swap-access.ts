import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAdminSession, requireSession } from '@/lib/auth-server'
import { isOwlSwapPublic } from '@/lib/owl-swap/access'

/**
 * Server gate for OwlSwap mutating / private routes.
 * Public mode: any SIWS session. Admin-only: requireAdminSession.
 */
export async function requireOwlSwapAccess(
  request: NextRequest
): Promise<{ wallet: string } | NextResponse> {
  if (isOwlSwapPublic()) {
    return requireSession(request)
  }
  return requireAdminSession(request)
}
