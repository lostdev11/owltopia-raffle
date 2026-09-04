import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  executeUnstakeAdminOverride,
  executeUnstakeAdminOverrideForWallet,
} from '@/lib/nesting/service'
import { listAdminOverrideUnstakeCandidates } from '@/lib/nesting/admin-unstake-override'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/unstake-override
 *
 * Single nest: `{ position_id: string }` — UUID of `staking_positions.id`.
 * All nests for a holder: `{ wallet_address: string, unstake_all: true }` — closes up to 25
 * eligible open nests per call (re-run if `remaining_eligible` > 0).
 * Preview only: `{ wallet_address: string, preview: true }` — lists candidates, no mutations.
 *
 * Runs the same adapter path as the holder "Leave nest" (thaw NFT or return tokens from vault),
 * bypassing lock timer / council vote lock / global nesting pause.
 *
 * MPL Core Owner-authority freezes cannot be thawed by the server keypair. Admin recovery still
 * closes the DB nest and returns `needs_owner_thaw` / `nest_owner_thaw` so the holder can thaw
 * from their wallet (`updatePlugin frozen:false`).
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => null)
    const position_id = typeof body?.position_id === 'string' ? body.position_id.trim() : ''
    const wallet_address =
      typeof body?.wallet_address === 'string' ? body.wallet_address.trim() : ''
    const preview = body?.preview === true
    const unstake_all = body?.unstake_all === true

    if (wallet_address && (preview || unstake_all)) {
      if (preview && !unstake_all) {
        const listed = await listAdminOverrideUnstakeCandidates(wallet_address)
        return NextResponse.json({
          preview: true,
          wallet: listed.wallet,
          candidates: listed.candidates,
          eligible_count: listed.candidates.length,
          open_position_count: listed.open_position_count,
          admin_override: true,
        })
      }

      const result = await executeUnstakeAdminOverrideForWallet({ wallet_address })

      console.warn('[admin/staking/unstake-override]', {
        admin_wallet: session.wallet,
        mode: 'wallet_unstake_all',
        holder_wallet: result.wallet,
        closed: result.closed.length,
        failed: result.failed.length,
        remaining_eligible: result.remaining_eligible,
        needs_owner_thaw_count: result.needs_owner_thaw_count,
        failed_errors: result.failed.map((f) => ({
          position_id: f.position_id,
          asset: f.asset_identifier,
          error: f.error,
          status: f.status,
        })),
      })

      return NextResponse.json({
        ...result,
        admin_override: true,
        unstake_all: true,
      })
    }

    if (!position_id) {
      return NextResponse.json(
        {
          error:
            'Provide position_id, or wallet_address with unstake_all: true (or preview: true)',
        },
        { status: 400 }
      )
    }

    const { position, nest_owner_thaw } = await executeUnstakeAdminOverride({ position_id })

    console.warn('[admin/staking/unstake-override]', {
      admin_wallet: session.wallet,
      position_id,
      holder_wallet: position.wallet_address,
      needs_owner_thaw: Boolean(nest_owner_thaw?.mint),
    })

    return NextResponse.json({
      position,
      holder_wallet: position.wallet_address,
      admin_override: true,
      needs_owner_thaw: Boolean(nest_owner_thaw?.mint),
      nest_owner_thaw: nest_owner_thaw?.mint ? { mint: nest_owner_thaw.mint } : null,
      execution: {
        path: position.unstake_signature ? ('onchain_token_transfer' as const) : ('database_mock' as const),
        ...(nest_owner_thaw?.mint
          ? { nest_owner_thaw: { mint: nest_owner_thaw.mint } }
          : {}),
      },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[admin/staking/unstake-override]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
