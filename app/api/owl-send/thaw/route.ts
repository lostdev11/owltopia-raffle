import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isAdmin } from '@/lib/db/admins'
import { canAccessOwlSend } from '@/lib/owl-send/access'
import { thawOwlSendFrozenNfts } from '@/lib/owl-send/thaw-frozen-nfts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

function isPubkey(s: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(s)
    return true
  } catch {
    return false
  }
}

/**
 * POST /api/owl-send/thaw
 * body: { mints: string[] }
 *
 * Thaws frozen Gen2 ATAs for the session wallet (orphaned nest lock or leftover CM mint freeze)
 * so OwlSend can transfer. Refuses when an active/pending nest still exists.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (!connected || connected !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Sign in with this wallet.' },
        { status: 401 }
      )
    }

    const viewerIsAdmin = await isAdmin(session.wallet)
    if (!canAccessOwlSend({ isAdmin: viewerIsAdmin })) {
      return NextResponse.json({ error: 'OwlSend is not available for this wallet.' }, { status: 403 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-send-thaw:${ip}:${session.wallet}`, 12, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many thaw requests. Wait a minute and retry.' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as { mints?: unknown } | null
    const rawMints = Array.isArray(body?.mints) ? body!.mints : []
    const mints = rawMints
      .filter((m): m is string => typeof m === 'string')
      .map((m) => m.trim())
      .filter((m) => isPubkey(m))

    if (mints.length < 1) {
      return NextResponse.json({ error: 'Provide at least one valid mint to thaw.' }, { status: 400 })
    }

    const { results, thawedCount } = await thawOwlSendFrozenNfts({
      ownerWallet: session.wallet,
      mints,
    })

    const blocked = results.filter((r) => !r.ok)
    const ok = blocked.length === 0
    return NextResponse.json({
      ok,
      thawedCount,
      results,
      error: ok
        ? undefined
        : blocked
            .map((r) => r.error || `${r.mint.slice(0, 4)}… failed`)
            .slice(0, 3)
            .join(' '),
    })
  } catch (e) {
    console.error('owl-send thaw POST', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to thaw NFTs' },
      { status: 500 }
    )
  }
}
