import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  addPackTestWallet,
  listPackTestWallets,
  removePackTestWallet,
} from '@/lib/db/pack-test-wallets'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const wallets = await listPackTestWallets()
    return NextResponse.json({ wallets })
  } catch (e) {
    console.error('[admin packs test-wallets] GET', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list test wallets' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const wallet = typeof body.wallet === 'string' ? body.wallet : ''
    const note = typeof body.note === 'string' ? body.note : null
    const result = await addPackTestWallet({
      wallet,
      createdByWallet: session.wallet,
      note,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const wallets = await listPackTestWallets()
    return NextResponse.json({ ok: true, wallets })
  } catch (e) {
    console.error('[admin packs test-wallets] POST', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to add wallet' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const wallet =
      request.nextUrl.searchParams.get('wallet')?.trim() ||
      (await request.json().catch(() => ({}))).wallet
    if (typeof wallet !== 'string' || !wallet.trim()) {
      return NextResponse.json({ error: 'wallet required' }, { status: 400 })
    }
    const result = await removePackTestWallet(wallet)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const wallets = await listPackTestWallets()
    return NextResponse.json({ ok: true, wallets })
  } catch (e) {
    console.error('[admin packs test-wallets] DELETE', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to remove wallet' },
      { status: 500 }
    )
  }
}
