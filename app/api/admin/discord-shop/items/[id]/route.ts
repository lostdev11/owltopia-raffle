import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getShopItemById, removeShopItem } from '@/lib/db/discord-marketplace-shop-items'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

/** DELETE /api/admin/discord-shop/items/[id] */
export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await ctx.params
    const item = await getShopItemById(id)
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    const ok = await removeShopItem(id)
    if (!ok) return NextResponse.json({ error: 'Could not remove item' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/discord-shop/items DELETE]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
