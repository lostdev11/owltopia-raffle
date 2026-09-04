import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getSolanaConnection } from '@/lib/solana/connection'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  MPL_CORE_OWNER_THAW_PREPARE_MAX,
  prepareMplCoreOwnerThawTransaction,
} from '@/lib/solana/mpl-core-owner-thaw-prepare'

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
 * POST /api/me/staking/prepare-owner-thaw
 * Body: { mints: string[] } (max 4)
 *
 * Builds unsigned Owner FreezeDelegate thaw txs on the **server** private RPC
 * so leftover nest thaws work when the browser cannot reach Solana RPC.
 * Holder still signs each tx in their wallet.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connected && connected !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Sign in with this wallet.' },
        { status: 401 }
      )
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`prepare-owner-thaw:${ip}:${session.wallet}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many thaw prepare requests. Wait a minute and retry.' },
        { status: 429 }
      )
    }

    const body = (await request.json().catch(() => null)) as { mints?: unknown } | null
    const rawMints = Array.isArray(body?.mints) ? body!.mints : []
    const mints = [
      ...new Set(
        rawMints
          .filter((m): m is string => typeof m === 'string')
          .map((m) => m.trim())
          .filter((m) => isPubkey(m))
      ),
    ].slice(0, MPL_CORE_OWNER_THAW_PREPARE_MAX)

    if (mints.length < 1) {
      return NextResponse.json({ error: 'Provide at least one valid mint to thaw.' }, { status: 400 })
    }

    const connection = getSolanaConnection()
    const items = []
    for (const mint of mints) {
      items.push(
        await prepareMplCoreOwnerThawTransaction({
          connection,
          ownerWallet: session.wallet,
          assetId: mint,
        })
      )
    }

    return NextResponse.json({
      ok: true,
      items,
      owner: session.wallet,
    })
  } catch (e) {
    console.error('[me/staking/prepare-owner-thaw]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
