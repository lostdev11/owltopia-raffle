import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { reconcileAllActiveNftFreezeLocksAdmin } from '@/lib/nesting/reconcile-active-nft-freeze'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/nft-freeze-catchup
 * Re-applies MPL Core freeze for active NFT nests missing on-chain lock (legacy DB-only stakes).
 * Body: { pool_slug?: string, limit?: number }
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => null)
    const poolSlug =
      typeof body?.pool_slug === 'string' && body.pool_slug.trim()
        ? body.pool_slug.trim()
        : 'owl-nest-365'
    const limit =
      typeof body?.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined

    const result = await reconcileAllActiveNftFreezeLocksAdmin({ poolSlug, limit })

    console.warn('[admin/staking/nft-freeze-catchup]', {
      admin_wallet: session.wallet,
      pool_slug: poolSlug,
      ...result,
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[admin/staking/nft-freeze-catchup]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
