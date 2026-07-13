import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  createShopItem,
  listShopItems,
  slugifyShopItemSlug,
} from '@/lib/db/discord-marketplace-shop-items'
import {
  getDiscordMarketplaceEscrowPublicKey,
  marketplaceEscrowOwlBalanceUi,
} from '@/lib/solana/discord-marketplace-escrow'
import { getDiscordMarketplacePaymentWalletAddress } from '@/lib/solana/discord-marketplace-payment-wallet'
import { safeErrorMessage } from '@/lib/safe-error'
import { notifyMarketplaceShopItemLive } from '@/lib/discord-marketplace-webhooks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function defaultGuildId(): string | null {
  return process.env.DISCORD_GUILD_ID?.trim() || null
}

const createSchema = z.object({
  discord_guild_id: z.string().trim().optional(),
  display_name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(48).optional(),
  description: z.string().trim().max(500).optional(),
  deposit_kind: z.enum(['none', 'nft', 'owl_spl']),
  asset_mint: z.string().trim().optional(),
  units_per_sale: z.number().positive().optional(),
  price_amount: z.number().positive(),
  price_currency: z.enum(['POINTS', 'SOL', 'OWL']),
  treasury_funded: z.boolean().optional(),
})

/** GET /api/admin/discord-shop/items — list shop items + wallet addresses */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const guildId = request.nextUrl.searchParams.get('guild_id')?.trim() || defaultGuildId()
    if (!guildId) {
      return NextResponse.json({ error: 'DISCORD_GUILD_ID not configured' }, { status: 503 })
    }

    const items = await listShopItems(guildId)
    const escrow = getDiscordMarketplaceEscrowPublicKey()
    const payment = getDiscordMarketplacePaymentWalletAddress()
    const escrowOwlBalance = escrow ? await marketplaceEscrowOwlBalanceUi() : 0

    return NextResponse.json({
      guild_id: guildId,
      escrow_wallet: escrow,
      payment_wallet: payment,
      escrow_owl_balance: escrowOwlBalance,
      items,
    })
  } catch (e) {
    console.error('[admin/discord-shop/items GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/** POST /api/admin/discord-shop/items — create listing from unified admin form */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const parsed = createSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
    }

    const body = parsed.data
    const guildId = body.discord_guild_id || defaultGuildId()
    if (!guildId) {
      return NextResponse.json({ error: 'DISCORD_GUILD_ID not configured' }, { status: 503 })
    }

    if (body.deposit_kind === 'nft' && !body.asset_mint) {
      return NextResponse.json({ error: 'asset_mint required for NFT listings' }, { status: 400 })
    }

    const units =
      body.deposit_kind === 'owl_spl'
        ? body.units_per_sale ?? body.price_amount
        : body.deposit_kind === 'nft'
          ? 1
          : body.units_per_sale ?? 1

    if (body.deposit_kind === 'owl_spl' && (!units || units <= 0)) {
      return NextResponse.json({ error: 'units_per_sale required for OWL inventory listings' }, { status: 400 })
    }

    const slug =
      slugifyShopItemSlug(body.slug ?? body.display_name) ||
      slugifyShopItemSlug(`item-${Date.now()}`)

    const treasuryFunded = Boolean(body.treasury_funded) && body.deposit_kind === 'owl_spl'

    const item = await createShopItem({
      discord_guild_id: guildId,
      slug,
      display_name: body.display_name,
      description: body.description ?? null,
      deposit_kind: body.deposit_kind,
      asset_mint: body.deposit_kind === 'nft' ? body.asset_mint : null,
      units_per_sale: units,
      price_amount: body.price_amount,
      price_currency: body.price_currency,
      treasury_funded: treasuryFunded && body.deposit_kind === 'owl_spl',
      listed_by_wallet: session.wallet,
    })

    if (!item) {
      return NextResponse.json({ error: 'Could not create shop item (duplicate slug?)' }, { status: 500 })
    }

    if (item.status === 'available') {
      notifyMarketplaceShopItemLive(item)
    }

    return NextResponse.json({
      item,
      escrow_wallet: getDiscordMarketplaceEscrowPublicKey(),
      payment_wallet: getDiscordMarketplacePaymentWalletAddress(),
      next_step:
        item.status === 'pending_deposit'
          ? 'Approve the wallet deposit to escrow, then the listing will publish automatically'
          : 'Item is live — users can buy in Discord',
    })
  } catch (e) {
    console.error('[admin/discord-shop/items POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
