import { NextRequest, NextResponse } from 'next/server'
import { getOwlVisionAdminRole } from '@/lib/admin/access'
import { getSessionFromRequest } from '@/lib/auth-server'
import { isWalletOnPackTestAllowlist } from '@/lib/db/pack-test-wallets'
import { resolvePackAccess } from '@/lib/packs/access'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/packs/access-check?wallet=… | ?session=1
 * Returns whether the caller may use Packs (public / admin / test allowlist).
 * Does not leak the full allowlist.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`packs-access-check:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const searchParams = request.nextUrl.searchParams
    let wallet = ''

    if (searchParams.get('session') === '1') {
      const session = getSessionFromRequest(request)
      wallet = session?.wallet?.trim() ?? ''
    } else {
      wallet = searchParams.get('wallet')?.trim() ?? ''
    }

    const normalized = wallet ? normalizeSolanaWalletAddress(wallet) : null
    if (!normalized) {
      const { isPublic, accessMode, killSwitch } = await resolvePackAccess({
        isAdmin: false,
        isTester: false,
      })
      return NextResponse.json({
        allowed: isPublic,
        isAdmin: false,
        isTester: false,
        isPublic,
        accessMode,
        killSwitch,
      })
    }

    const role = await getOwlVisionAdminRole(normalized)
    const isAdmin = role !== null
    const isTester = isAdmin ? false : await isWalletOnPackTestAllowlist(normalized)
    const resolved = await resolvePackAccess({ isAdmin, isTester })

    return NextResponse.json({
      allowed: resolved.allowed,
      isAdmin,
      isTester,
      isPublic: resolved.isPublic,
      accessMode: resolved.accessMode,
      killSwitch: resolved.killSwitch,
      role: isAdmin ? role : undefined,
    })
  } catch (e) {
    console.error('[packs/access-check]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Access check failed' },
      { status: 500 }
    )
  }
}
