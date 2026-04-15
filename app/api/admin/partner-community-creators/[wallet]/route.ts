import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  deletePartnerCommunityCreator,
  updatePartnerCommunityCreator,
} from '@/lib/db/partner-community-creators-admin'
import { clearPartnerCommunityWalletCache } from '@/lib/raffles/partner-communities'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function walletFromParams(params: { wallet: string }): string | null {
  const decoded = decodeURIComponent(params.wallet ?? '').trim()
  return normalizeSolanaWalletAddress(decoded)
}

/**
 * PATCH /api/admin/partner-community-creators/[wallet]
 * Body: { display_label?, sort_order?, is_active? }
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ wallet: string }> }) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const creator_wallet = walletFromParams(params)
    if (!creator_wallet) {
      return NextResponse.json({ error: 'Invalid wallet in path' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const patch: {
      display_label?: string | null
      sort_order?: number
      is_active?: boolean
    } = {}

    if ('display_label' in body) {
      if (body.display_label === null) {
        patch.display_label = null
      } else if (typeof body.display_label === 'string') {
        patch.display_label = body.display_label.trim() || null
      } else {
        return NextResponse.json({ error: 'display_label must be a string or null' }, { status: 400 })
      }
    }
    if ('sort_order' in body && body.sort_order !== null && body.sort_order !== undefined) {
      const n = Number(body.sort_order)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return NextResponse.json({ error: 'sort_order must be an integer' }, { status: 400 })
      }
      patch.sort_order = n
    }
    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 400 })
      }
      patch.is_active = body.is_active
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const row = await updatePartnerCommunityCreator(creator_wallet, patch)
    clearPartnerCommunityWalletCache()
    return NextResponse.json({ creator: row })
  } catch (error) {
    console.error('[admin/partner-community-creators PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/partner-community-creators/[wallet] — removes the row (not just inactive).
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ wallet: string }> }) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const creator_wallet = walletFromParams(params)
    if (!creator_wallet) {
      return NextResponse.json({ error: 'Invalid wallet in path' }, { status: 400 })
    }

    await deletePartnerCommunityCreator(creator_wallet)
    clearPartnerCommunityWalletCache()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[admin/partner-community-creators DELETE]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
