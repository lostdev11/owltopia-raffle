import { NextRequest, NextResponse } from 'next/server'

import {
  addGen2WhitelistWallet,
  listGen2WhitelistWallets,
  removeGen2WhitelistWallet,
} from '@/lib/db/gen2-whitelist'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** GET /api/admin/gen2-presale/whitelist */
export async function GET(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 500
    const rows = await listGen2WhitelistWallets(limit)
    return NextResponse.json({ wallets: rows })
  } catch (e) {
    console.error('[admin/gen2-presale/whitelist GET]', e)
    return NextResponse.json({ error: 'Failed to load whitelist' }, { status: 500 })
  }
}

/** POST /api/admin/gen2-presale/whitelist — body: { wallet, note? } */
export async function POST(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-whitelist-add:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as { wallet?: string; note?: string }
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
    }

    const result = await addGen2WhitelistWallet({
      wallet,
      createdByWallet: session.wallet,
      note: typeof body.note === 'string' ? body.note : null,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    console.info('[admin/gen2-presale/whitelist] added', {
      tag: 'gen2_whitelist_wallet',
      admin_wallet: session.wallet,
      recipient_wallet: wallet,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/gen2-presale/whitelist POST]', e)
    return NextResponse.json({ error: 'Failed to add whitelist wallet' }, { status: 500 })
  }
}

/** DELETE /api/admin/gen2-presale/whitelist?wallet=... */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet query param is required' }, { status: 400 })
    }

    const result = await removeGen2WhitelistWallet(wallet)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    console.info('[admin/gen2-presale/whitelist] removed', {
      tag: 'gen2_whitelist_wallet',
      admin_wallet: session.wallet,
      recipient_wallet: wallet,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/gen2-presale/whitelist DELETE]', e)
    return NextResponse.json({ error: 'Failed to remove whitelist wallet' }, { status: 500 })
  }
}
