import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listStakingPositionsByWallet, patchStakingPosition } from '@/lib/db/staking-positions'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const OWNER_THAW_PREFIX = 'nft_needs_owner_thaw:'

/**
 * POST /api/me/staking/ack-owner-thaw
 * Body: { mints: string[] }
 * Clears `nft_needs_owner_thaw:` external_reference on the caller's unstaked rows after
 * they thawed Owner-authority FreezeDelegates in-wallet (e.g. post admin force-leave).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => null)
    const mints = Array.isArray(body?.mints)
      ? [
          ...new Set(
            body.mints
              .filter((m: unknown): m is string => typeof m === 'string')
              .map((m: string) => m.trim())
              .filter(Boolean)
          ),
        ]
      : []
    if (mints.length === 0) {
      return NextResponse.json({ error: 'mints required' }, { status: 400 })
    }
    const mintSet = new Set(mints)

    const rows = await listStakingPositionsByWallet(session.wallet)
    const targets = rows.filter((r) => {
      if (r.status !== 'unstaked') return false
      const ref = (r.external_reference ?? '').trim()
      if (!ref.startsWith(OWNER_THAW_PREFIX)) return false
      const mint = ref.slice(OWNER_THAW_PREFIX.length).trim()
      return mintSet.has(mint)
    })

    let cleared = 0
    for (const row of targets) {
      await patchStakingPosition(row.id, {
        external_reference: `nft_owner_thaw_acked:${row.asset_identifier ?? row.id}`,
        last_synced_at: new Date().toISOString(),
      })
      cleared += 1
    }

    return NextResponse.json({ cleared, mints: [...mintSet] })
  } catch (e) {
    console.error('[me/staking/ack-owner-thaw]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
