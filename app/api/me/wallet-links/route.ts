import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import {
  deleteWalletLink,
  insertWalletLink,
  MAX_WALLET_LINKS_PER_PRIMARY,
} from '@/lib/db/wallet-links'
import { resolveWalletCluster } from '@/lib/wallet-cluster'
import { verifyWalletLinkSignature } from '@/lib/wallet-link-auth'
import { walletLinkVerifyBody } from '@/lib/validations'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/** GET /api/me/wallet-links — cluster for signed-in wallet */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const cluster = await resolveWalletCluster(session.wallet)
    if (!cluster) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    return NextResponse.json({
      ...cluster,
      max_links: MAX_WALLET_LINKS_PER_PRIMARY,
    })
  } catch (e) {
    console.error('[me/wallet-links GET]', e)
    return NextResponse.json({ error: 'Failed to load wallet links' }, { status: 500 })
  }
}

/** POST /api/me/wallet-links — link an additional wallet (signature from linked wallet) */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`wallet-link-add:${session.wallet}`, 15, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const cluster = await resolveWalletCluster(session.wallet)
    if (!cluster) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    if (!cluster.is_primary) {
      return NextResponse.json(
        {
          error:
            'Sign in with your primary wallet to add links. This wallet is linked to another account.',
          code: 'not_primary',
          primary_wallet: cluster.primary_wallet,
        },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = walletLinkVerifyBody.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const linked = normalizeSolanaWalletAddress(parsed.data.linked_wallet)
    const primary = cluster.primary_wallet
    if (!linked) {
      return NextResponse.json({ error: 'Invalid linked wallet' }, { status: 400 })
    }

    const verified = verifyWalletLinkSignature(
      primary,
      linked,
      parsed.data.message,
      parsed.data.signature
    )
    if (!verified.valid) {
      return NextResponse.json(
        { error: verified.error || 'Invalid link signature' },
        { status: 400 }
      )
    }

    const result = await insertWalletLink(primary, linked)
    if (!result.ok) {
      const status =
        result.code === 'linked_taken' || result.code === 'limit' || result.code === 'primary_is_linked'
          ? 409
          : 400
      return NextResponse.json({ error: result.message, code: result.code }, { status })
    }

    console.info('[me/wallet-links] linked', {
      tag: 'wallet_link_add',
      primary_wallet: primary,
      linked_wallet: linked,
    })

    const updated = await resolveWalletCluster(session.wallet)
    return NextResponse.json({ ok: true, cluster: updated })
  } catch (e) {
    console.error('[me/wallet-links POST]', e)
    return NextResponse.json({ error: 'Failed to link wallet' }, { status: 500 })
  }
}

/** DELETE /api/me/wallet-links?linked_wallet=... */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const cluster = await resolveWalletCluster(session.wallet)
    if (!cluster?.is_primary) {
      return NextResponse.json(
        { error: 'Only the primary wallet can remove linked wallets.', code: 'not_primary' },
        { status: 403 }
      )
    }

    const linkedRaw = request.nextUrl.searchParams.get('linked_wallet')?.trim() ?? ''
    const linked = normalizeSolanaWalletAddress(linkedRaw)
    if (!linked) {
      return NextResponse.json({ error: 'linked_wallet query param required' }, { status: 400 })
    }

    const exists = cluster.linked_wallets.some((r) => walletsEqualSolana(r.linked_wallet, linked))
    if (!exists) {
      return NextResponse.json({ error: 'Wallet is not linked to this account' }, { status: 404 })
    }

    const result = await deleteWalletLink(cluster.primary_wallet, linked)
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    console.info('[me/wallet-links] unlinked', {
      tag: 'wallet_link_remove',
      primary_wallet: cluster.primary_wallet,
      linked_wallet: linked,
    })

    const updated = await resolveWalletCluster(session.wallet)
    return NextResponse.json({ ok: true, cluster: updated })
  } catch (e) {
    console.error('[me/wallet-links DELETE]', e)
    return NextResponse.json({ error: 'Failed to unlink wallet' }, { status: 500 })
  }
}
