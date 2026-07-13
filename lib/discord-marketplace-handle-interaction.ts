import { generateDiscordMarketplaceLinkState } from '@/lib/discord-marketplace-link-state'
import { fulfillMarketplaceOwlDelivery } from '@/lib/solana/discord-marketplace-fulfill'
import { isAdmin } from '@/lib/db/admins'
import {
  createMarketplaceOrder,
  getMarketplacePointsBalance,
  getMarketplaceProductBySlug,
  grantMarketplacePoints,
  listActiveMarketplaceProducts,
  listAllMarketplaceProducts,
  listRecentMarketplaceOrders,
  markMarketplaceOrderFailed,
  markMarketplaceOrderFulfilled,
  refundMarketplaceOrder,
  slugifyMarketplaceProductSlug,
  upsertMarketplaceProduct,
} from '@/lib/db/discord-marketplace'
import { getWalletAddressByDiscordUserId } from '@/lib/db/wallet-profiles'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { gen2PresaleExplorerTxUrl } from '@/lib/gen2-presale/explorer'

const ADMINISTRATOR_BIT = 0x8n

function ephemeral(content: string) {
  return {
    type: 4,
    data: {
      content: content.slice(0, 2000),
      flags: 64,
    },
  }
}

function embedResponse(embed: Record<string, unknown>) {
  return {
    type: 4,
    data: {
      embeds: [embed],
      flags: 64,
    },
  }
}

type DiscordInteraction = {
  type: number
  guild_id?: string
  member?: { permissions?: string; user?: { id: string; username?: string } }
  data?: {
    name?: string
    options?: Array<{ name: string; type: number; value?: string | number; options?: unknown[] }>
  }
}

function getSubcommandAndOptions(data: DiscordInteraction['data']): {
  sub: string | null
  nestedSub: string | null
  strOptions: Record<string, string>
  numOptions: Record<string, number>
} {
  const opts = data?.options ?? []
  const sub = opts.find((o) => o.type === 1)
  if (!sub) return { sub: null, nestedSub: null, strOptions: {}, numOptions: {} }

  const nested = (sub.options ?? []).find(
    (o): o is { name: string; type: number; options?: Array<{ name: string; type: number; value?: string | number }> } =>
      typeof o === 'object' && o != null && 'type' in o && (o as { type: number }).type === 1
  )

  const strOptions: Record<string, string> = {}
  const numOptions: Record<string, number> = {}

  const collect = (items: Array<{ name: string; type: number; value?: string | number }>) => {
    for (const o of items) {
      if (o.type === 3 && typeof o.value === 'string') strOptions[o.name] = o.value
      if (o.type === 4 && typeof o.value === 'number') numOptions[o.name] = o.value
      if (o.type === 10 && typeof o.value === 'number') numOptions[o.name] = o.value
    }
  }

  if (nested) {
    collect((nested.options ?? []) as Array<{ name: string; type: number; value?: string | number }>)
    return { sub: sub.name ?? null, nestedSub: nested.name ?? null, strOptions, numOptions }
  }

  collect((sub.options ?? []) as Array<{ name: string; type: number; value?: string | number }>)
  return { sub: sub.name ?? null, nestedSub: null, strOptions, numOptions }
}

function memberIsAdministrator(member: DiscordInteraction['member']): boolean {
  if (!member?.permissions) return false
  try {
    return (BigInt(member.permissions) & ADMINISTRATOR_BIT) !== 0n
  } catch {
    return false
  }
}

async function memberCanManageShop(
  member: DiscordInteraction['member']
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (memberIsAdministrator(member)) return { ok: true }
  const did = member?.user?.id?.trim()
  if (!did) return { ok: false, message: 'Could not read your Discord user id.' }
  const wallet = await getWalletAddressByDiscordUserId(did)
  if (!wallet) {
    return {
      ok: false,
      message: `Link your wallet on ${getSiteBaseUrl()}/discord-shop/connect (run \`/owltopia-shop wallet\`) — admin commands require a linked Owltopia founder wallet.`,
    }
  }
  if (await isAdmin(wallet)) return { ok: true }
  return { ok: false, message: 'Shop admin commands require server Administrator or an Owltopia founder wallet.' }
}

function orderStatusEmoji(status: string): string {
  switch (status) {
    case 'fulfilled':
      return '🟢'
    case 'pending_fulfillment':
      return '🟡'
    case 'fulfillment_failed':
      return '🔴'
    case 'refunded':
      return '↩️'
    default:
      return '⚪'
  }
}

export async function handleDiscordMarketplaceCommand(
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> {
  const guildId = interaction.guild_id
  if (!guildId) {
    return ephemeral('Use this command in a server, not in DMs.')
  }

  const discordUserId = interaction.member?.user?.id?.trim()
  if (!discordUserId) {
    return ephemeral('Could not read your Discord user id. Try again in a server channel.')
  }

  const { sub, nestedSub, strOptions, numOptions } = getSubcommandAndOptions(interaction.data)

  if (sub === 'browse' || sub === 'shop') {
    const products = await listActiveMarketplaceProducts(guildId)
    if (products.length === 0) {
      return ephemeral(
        'No items in the shop yet. Admins can add products with `/owltopia-shop admin add-product`.'
      )
    }
    const lines = products.map((p) => {
      const owl =
        p.owl_delivery_amount > 0 ? ` → auto-delivers **${p.owl_delivery_amount} OWL**` : ''
      return `• **${p.name}** (\`${p.slug}\`) — **${p.points_cost.toLocaleString()}** points${owl}`
    })
    return ephemeral(['**Owltopia Shop**', '', ...lines, '', 'Buy with `/owltopia-shop buy product:<slug>`'].join('\n'))
  }

  if (sub === 'balance') {
    const balance = await getMarketplacePointsBalance(discordUserId, guildId)
    return ephemeral(`Your balance: **${balance.toLocaleString()}** points`)
  }

  if (sub === 'wallet' || sub === 'connect-wallet') {
    const wallet = await getWalletAddressByDiscordUserId(discordUserId)
    const state = generateDiscordMarketplaceLinkState(discordUserId)
    const url = `${getSiteBaseUrl()}/discord-shop/connect?state=${encodeURIComponent(state)}`

    if (sub === 'connect-wallet') {
      return ephemeral(
        [
          `**${PLATFORM_NAME} — link wallet for shop delivery**`,
          '',
          'Open this link, connect your wallet, and sign in:',
          url,
          '',
          'This links your Discord account to your wallet for automatic OWL delivery after shop purchases.',
        ].join('\n')
      )
    }

    if (wallet) {
      const short = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
      return ephemeral(`Your linked wallet: \`${short}\` (\`${wallet}\`)`)
    }

    return ephemeral(
      [
        '**No wallet linked yet.**',
        '',
        'Connect your Solana wallet so purchases can be delivered automatically:',
        url,
        '',
        'Or run `/owltopia-shop connect-wallet` anytime for a fresh link.',
      ].join('\n')
    )
  }

  if (sub === 'purchases') {
    const orders = await listRecentMarketplaceOrders(discordUserId, guildId, 8)
    if (orders.length === 0) {
      return ephemeral('No purchases yet.')
    }
    const lines = orders.map((o) => {
      const date = new Date(o.created_at).toDateString()
      const tx =
        o.fulfillment_tx_signature && o.status === 'fulfilled'
          ? ` — [tx](${gen2PresaleExplorerTxUrl(o.fulfillment_tx_signature)})`
          : ''
      return `${orderStatusEmoji(o.status)} **${o.product_name}** — ${o.points_spent.toLocaleString()} pts on ${date} (${o.status})${tx}`
    })
    return embedResponse({
      title: 'Your Recent Purchases',
      description: lines.join('\n'),
      color: 0x9b59b6,
      footer: { text: '🟢 fulfilled · 🟡 pending · 🔴 failed · ↩️ refunded' },
    })
  }

  if (sub === 'buy') {
    const slug = (strOptions.product ?? '').trim().toLowerCase()
    if (!slug) {
      return ephemeral('Usage: `/owltopia-shop buy product:<slug>` — run `/owltopia-shop browse` to see items.')
    }

    const wallet = await getWalletAddressByDiscordUserId(discordUserId)
    if (!wallet) {
      const state = generateDiscordMarketplaceLinkState(discordUserId)
      const url = `${getSiteBaseUrl()}/discord-shop/connect?state=${encodeURIComponent(state)}`
      return ephemeral(
        [
          '**Connect your wallet first** so we can deliver your purchase automatically.',
          '',
          url,
        ].join('\n')
      )
    }

    const product = await getMarketplaceProductBySlug(guildId, slug)
    if (!product || !product.active) {
      return ephemeral(`Product \`${slug}\` not found. Run \`/owltopia-shop browse\` for available items.`)
    }

    const balance = await getMarketplacePointsBalance(discordUserId, guildId)
    if (balance < product.points_cost) {
      return ephemeral(
        `Not enough points. **${product.name}** costs **${product.points_cost.toLocaleString()}** — you have **${balance.toLocaleString()}**.`
      )
    }

    const orderResult = await createMarketplaceOrder({
      discord_user_id: discordUserId,
      discord_guild_id: guildId,
      product_id: product.id,
      recipient_wallet: wallet,
    })

    if (!orderResult.ok) {
      return ephemeral(orderResult.message)
    }

    if (product.owl_delivery_amount > 0) {
      const delivery = await fulfillMarketplaceOwlDelivery({
        recipientWallet: wallet,
        owlAmountUi: product.owl_delivery_amount,
      })

      if (delivery.kind === 'sent') {
        await markMarketplaceOrderFulfilled(orderResult.order_id, delivery.signature)
        const shortWallet = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
        return embedResponse({
          title: '🎉 New Shop Purchase!',
          description: [
            `Congratulations! You acquired **${product.name}**.`,
            '',
            `**Cost:** ${orderResult.points_spent.toLocaleString()} points`,
            `**Delivered:** ${product.owl_delivery_amount} OWL → \`${shortWallet}\``,
            `[View transaction](${gen2PresaleExplorerTxUrl(delivery.signature)})`,
          ].join('\n'),
          color: 0x2ecc71,
        })
      }

      if (delivery.kind === 'failed') {
        await markMarketplaceOrderFailed(orderResult.order_id, delivery.error)
        await refundMarketplaceOrder(orderResult.order_id)
        return ephemeral(
          `Purchase could not be delivered on-chain (${delivery.error}). Your points were refunded. Contact support if this persists.`
        )
      }

      // zero_amount / skipped — points-only product with misconfigured owl amount 0 path shouldn't happen
      await markMarketplaceOrderFulfilled(orderResult.order_id, 'no-on-chain-delivery')
    } else {
      await markMarketplaceOrderFulfilled(orderResult.order_id, 'points-only')
    }

    return embedResponse({
      title: '🎉 New Shop Purchase!',
      description: [
        `Congratulations! You acquired **${product.name}**.`,
        '',
        `**Cost:** ${orderResult.points_spent.toLocaleString()} points`,
        product.owl_delivery_amount > 0
          ? ''
          : '_This item does not include on-chain OWL delivery._',
      ]
        .filter(Boolean)
        .join('\n'),
      color: 0x2ecc71,
    })
  }

  if (sub === 'admin') {
    const access = await memberCanManageShop(interaction.member)
    if (!access.ok) return ephemeral(access.message)

    if (nestedSub === 'add-product') {
      const name = (strOptions.name ?? '').trim()
      const slug = slugifyMarketplaceProductSlug(strOptions.slug ?? name)
      const points = numOptions.points
      const owl = numOptions.owl ?? 0
      if (!name || !slug || !Number.isFinite(points) || points <= 0) {
        return ephemeral(
          'Usage: `/owltopia-shop admin add-product name:… points:… owl:…` (owl optional, default 0)'
        )
      }
      const product = await upsertMarketplaceProduct({
        discord_guild_id: guildId,
        slug,
        name,
        description: strOptions.description ?? null,
        points_cost: Math.trunc(points),
        owl_delivery_amount: owl,
        active: true,
      })
      if (!product) return ephemeral('Could not save product (database error).')
      return ephemeral(
        `Saved **${product.name}** (\`${product.slug}\`) — ${product.points_cost.toLocaleString()} points, ${product.owl_delivery_amount} OWL auto-delivery.`
      )
    }

    if (nestedSub === 'grant-points') {
      const targetUser = (strOptions.user ?? '').trim()
      const amount = numOptions.amount
      if (!targetUser || !Number.isFinite(amount) || amount === 0) {
        return ephemeral('Usage: `/owltopia-shop admin grant-points user:<discord_user_id> amount:…`')
      }
      const next = await grantMarketplacePoints({
        discord_user_id: targetUser,
        discord_guild_id: guildId,
        delta: Math.trunc(amount),
      })
      if (next == null) return ephemeral('Could not update points.')
      return ephemeral(`User \`${targetUser}\` now has **${next.toLocaleString()}** points.`)
    }

    if (nestedSub === 'list-products') {
      const products = await listAllMarketplaceProducts(guildId)
      if (products.length === 0) return ephemeral('No products configured.')
      const lines = products.map(
        (p) =>
          `${p.active ? '🟢' : '🔴'} **${p.name}** (\`${p.slug}\`) — ${p.points_cost.toLocaleString()} pts, ${p.owl_delivery_amount} OWL`
      )
      return ephemeral(['**All shop products**', '', ...lines].join('\n'))
    }

    return ephemeral(
      'Admin subcommands: `add-product`, `grant-points`, `list-products`'
    )
  }

  return ephemeral(
    [
      '**Owltopia Shop**',
      '',
      '`/owltopia-shop browse` — list items',
      '`/owltopia-shop buy` — purchase (wallet required)',
      '`/owltopia-shop wallet` — check linked wallet',
      '`/owltopia-shop connect-wallet` — link Solana wallet',
      '`/owltopia-shop balance` — your points',
      '`/owltopia-shop purchases` — order history',
    ].join('\n')
  )
}
