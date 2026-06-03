import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import {
  listCreatorBlacklistEntries,
  removeCreatorBlacklist,
  upsertCreatorBlacklist,
} from '@/lib/db/creator-moderation'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/creator-blacklist — list moderation-flagged creator wallets.
 * POST — add or update blacklist entry { walletAddress, reason, notes? }
 * DELETE — remove from blacklist (?wallet=...)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const entries = await listCreatorBlacklistEntries()
    return NextResponse.json({ entries })
  } catch (error) {
    console.error('[admin/creator-blacklist GET]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const walletRaw = typeof body.walletAddress === 'string' ? body.walletAddress : body.wallet
    const walletAddress = normalizeSolanaWalletAddress(
      typeof walletRaw === 'string' ? walletRaw : ''
    )
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const notes = typeof body.notes === 'string' ? body.notes.trim() : null

    if (!walletAddress) {
      return NextResponse.json({ error: 'Valid walletAddress is required' }, { status: 400 })
    }
    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 })
    }

    const entry = await upsertCreatorBlacklist({
      walletAddress,
      reason,
      addedBy: session.wallet,
      notes,
    })
    if (!entry) {
      return NextResponse.json({ error: 'Could not save blacklist entry' }, { status: 500 })
    }

    return NextResponse.json({ entry })
  } catch (error) {
    console.error('[admin/creator-blacklist POST]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const walletParam = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    const walletAddress = normalizeSolanaWalletAddress(walletParam)
    if (!walletAddress) {
      return NextResponse.json({ error: 'wallet query param is required' }, { status: 400 })
    }

    const ok = await removeCreatorBlacklist(walletAddress)
    if (!ok) {
      return NextResponse.json({ error: 'Could not remove blacklist entry' }, { status: 500 })
    }

    return NextResponse.json({ success: true, walletAddress })
  } catch (error) {
    console.error('[admin/creator-blacklist DELETE]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
