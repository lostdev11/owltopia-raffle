import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getShopItemById, markShopItemAvailable } from '@/lib/db/discord-marketplace-shop-items'
import {
  verifyNftDepositedInMarketplaceEscrow,
  verifyOwlDepositedInMarketplaceEscrow,
} from '@/lib/solana/discord-marketplace-nft-escrow'
import { safeErrorMessage } from '@/lib/safe-error'
import { notifyMarketplaceShopItemLive } from '@/lib/discord-marketplace-webhooks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

/** POST /api/admin/discord-shop/items/[id]/verify-deposit */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await ctx.params
    const item = await getShopItemById(id)
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    if (item.status !== 'pending_deposit') {
      return NextResponse.json({ error: `Item status is ${item.status}, not pending_deposit` }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { deposit_tx?: string }

    if (item.deposit_kind === 'nft') {
      if (!item.asset_mint) {
        return NextResponse.json({ error: 'NFT mint missing on listing' }, { status: 400 })
      }
      const check = await verifyNftDepositedInMarketplaceEscrow(item.asset_mint)
      if (!check.ok) {
        return NextResponse.json({ error: check.error ?? 'NFT not in escrow' }, { status: 400 })
      }
    } else if (item.deposit_kind === 'owl_spl') {
      const check = await verifyOwlDepositedInMarketplaceEscrow(item.units_per_sale)
      if (!check.ok) {
        return NextResponse.json({ error: check.error ?? 'OWL not in escrow' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: 'This item does not require a deposit' }, { status: 400 })
    }

    const ok = await markShopItemAvailable(id, body.deposit_tx?.trim())
    if (!ok) return NextResponse.json({ error: 'Could not update item' }, { status: 500 })

    const updated = await getShopItemById(id)
    if (updated?.status === 'available') {
      notifyMarketplaceShopItemLive(updated)
    }
    return NextResponse.json({ ok: true, item: updated })
  } catch (e) {
    console.error('[admin/discord-shop/items/verify-deposit]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
