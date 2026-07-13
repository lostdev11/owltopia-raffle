import { generateDiscordMarketplaceLinkState } from '@/lib/discord-marketplace-link-state'
import { fulfillMarketplaceOwlDelivery } from '@/lib/solana/discord-marketplace-fulfill'
import {
  fulfillMarketplaceNftToBuyer,
  getDiscordMarketplaceNftEscrowAddress,
  verifyNftDepositedInMarketplaceEscrow,
} from '@/lib/solana/discord-marketplace-nft-escrow'
import {
  extractOwlShopMemosFromParsedTx,
  verifyDiscordMarketplaceNftPayment,
} from '@/lib/solana/verify-discord-marketplace-payment'
import { getDiscordMarketplacePaymentWalletAddress } from '@/lib/solana/discord-marketplace-payment-wallet'
import {
  completeShopItemOnchainSale,
  purchaseShopItemWithPoints,
} from '@/lib/discord-marketplace-purchase-shop-item'
import { getShopItemBySlug, listShopItems } from '@/lib/db/discord-marketplace-shop-items'
import { getSolanaConnection } from '@/lib/solana/connection'
import { isAdmin } from '@/lib/db/admins'
import {
  createMarketplaceOrder,
  getMarketplacePointsBalance,
  getMarketplaceProductBySlug,
  grantMarketplacePoints,
  listActiveMarketplaceProducts,
  listActiveOwlTokenProducts,
  listAllMarketplaceProducts,
  listRecentMarketplaceOrders,
  markMarketplaceOrderFailed,
  markMarketplaceOrderFulfilled,
  refundMarketplaceOrder,
  slugifyMarketplaceProductSlug,
  upsertMarketplaceProduct,
} from '@/lib/db/discord-marketplace'
import {
  completeNftSale,
  createNftListing,
  createNftPurchaseIntent,
  defaultNftListingSlugFromMint,
  findNftIntentByMemo,
  getNftListingBySlug,
  getNftListingById,
  isNftPaymentSignatureUsed,
  listAllNftListings,
  listAvailableNftListings,
  markNftIntentConfirmed,
  markNftListingAvailable,
  markNftListingFulfillmentFailed,
  markNftListingFulfilled,
  removeNftListing,
  slugifyNftListingSlug,
  type NftListingCurrency,
} from '@/lib/db/discord-marketplace-nfts'
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

function formatNftPrice(amount: number, currency: NftListingCurrency): string {
  if (currency === 'SOL') return `${amount} SOL`
  return `${amount} OWL`
}

function nftListingStatusEmoji(status: string): string {
  switch (status) {
    case 'available':
      return '🟢'
    case 'pending_deposit':
      return '🟡'
    case 'sold':
      return '✅'
    case 'fulfillment_failed':
      return '🔴'
    case 'removed':
      return '🗑️'
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
    const [products, owlBundles, nfts, shopItems] = await Promise.all([
      listActiveMarketplaceProducts(guildId),
      listActiveOwlTokenProducts(guildId),
      listAvailableNftListings(guildId),
      listShopItems(guildId, { status: 'available' }),
    ])
    const genericProducts = products.filter((p) => p.product_kind !== 'owl_tokens')
    if (genericProducts.length === 0 && owlBundles.length === 0 && nfts.length === 0 && shopItems.length === 0) {
      return ephemeral(
        'No items in the shop yet. Admins can add products or listings via `/owltopia-shop admin`.'
      )
    }
    const lines: string[] = ['**Owltopia Shop**', '']
    if (owlBundles.length > 0) {
      lines.push('**OWL tokens** (pay with points → auto-delivered to wallet)')
      for (const p of owlBundles) {
        lines.push(
          `• **${p.name}** (\`${p.slug}\`) — **${p.points_cost.toLocaleString()}** pts → **${p.owl_delivery_amount} OWL**`
        )
      }
      lines.push('', 'Buy: `/owltopia-shop buy product:<slug>`')
    }
    if (genericProducts.length > 0) {
      if (owlBundles.length > 0) lines.push('')
      lines.push('**Other points items**')
      for (const p of genericProducts) {
        const owl =
          p.owl_delivery_amount > 0 ? ` → **${p.owl_delivery_amount} OWL**` : ''
        lines.push(`• **${p.name}** (\`${p.slug}\`) — **${p.points_cost.toLocaleString()}** points${owl}`)
      }
      lines.push('', 'Buy: `/owltopia-shop buy product:<slug>`')
    }
    if (nfts.length > 0) {
      if (genericProducts.length > 0 || owlBundles.length > 0) lines.push('')
      lines.push('**NFT listings** (pay SOL or OWL on-chain)')
      for (const n of nfts) {
        const label = n.display_name ?? n.nft_mint.slice(0, 8) + '…'
        lines.push(
          `• **${label}** (\`${n.listing_slug}\`) — **${formatNftPrice(n.price_amount, n.currency)}**`
        )
      }
      lines.push('', 'Buy: `/owltopia-shop buy-nft listing:<slug>`')
    }
    if (shopItems.length > 0) {
      if (genericProducts.length > 0 || owlBundles.length > 0 || nfts.length > 0) lines.push('')
      lines.push('**Shop listings** (admin dashboard)')
      for (const s of shopItems) {
        const price =
          s.price_currency === 'POINTS'
            ? `${Math.trunc(s.price_amount).toLocaleString()} points`
            : `${s.price_amount} ${s.price_currency}`
        lines.push(`• **${s.display_name}** (\`${s.slug}\`) — ${price}`)
      }
      lines.push('', 'Points: `/owltopia-shop buy product:<slug>` · SOL/OWL: `/owltopia-shop buy-nft listing:<slug>`')
    }
    return ephemeral(lines.join('\n'))
  }

  if (sub === 'browse-owl') {
    const owlBundles = await listActiveOwlTokenProducts(guildId)
    if (owlBundles.length === 0) {
      return ephemeral(
        'No OWL token bundles listed. Admins: `/owltopia-shop admin list-owl owl:<amount> points:<cost>`'
      )
    }
    const lines = owlBundles.map(
      (p) =>
        `• **${p.name}** (\`${p.slug}\`) — **${p.points_cost.toLocaleString()}** points → **${p.owl_delivery_amount} OWL** auto-delivered`
    )
    return ephemeral(
      [
        '**OWL Token Shop** (pay with points)',
        '',
        ...lines,
        '',
        'Requires linked wallet: `/owltopia-shop connect-wallet`',
        'Buy: `/owltopia-shop buy product:<slug>`',
      ].join('\n')
    )
  }

  if (sub === 'browse-nfts') {
    const nfts = await listAvailableNftListings(guildId)
    if (nfts.length === 0) {
      return ephemeral('No NFTs listed for sale. Admins can list with `/owltopia-shop admin list-nft`.')
    }
    const lines = nfts.map((n) => {
      const label = n.display_name ?? n.nft_mint.slice(0, 8) + '…'
      return `• **${label}** (\`${n.listing_slug}\`) — **${formatNftPrice(n.price_amount, n.currency)}**`
    })
    return ephemeral(
      ['**NFT Marketplace**', '', ...lines, '', 'Buy: `/owltopia-shop buy-nft listing:<slug>`'].join('\n')
    )
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

    const shopItem = await getShopItemBySlug(guildId, slug)
    if (shopItem?.status === 'available' && shopItem.price_currency === 'POINTS') {
      const purchase = await purchaseShopItemWithPoints({
        item: shopItem,
        discord_user_id: discordUserId,
        discord_guild_id: guildId,
        recipient_wallet: wallet,
      })
      if (!purchase.ok) return ephemeral(purchase.message)
      const txLine = purchase.fulfillmentTx
        ? `\n[View delivery](${gen2PresaleExplorerTxUrl(purchase.fulfillmentTx)})`
        : ''
      return embedResponse({
        title: '🎉 Shop Purchase!',
        description: [`**${shopItem.display_name}**`, '', purchase.message + txLine].join('\n'),
        color: 0x2ecc71,
      })
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

  if (sub === 'buy-nft') {
    const listingSlug = (strOptions.listing ?? '').trim().toLowerCase()
    if (!listingSlug) {
      return ephemeral('Usage: `/owltopia-shop buy-nft listing:<slug>`')
    }

    const wallet = await getWalletAddressByDiscordUserId(discordUserId)
    if (!wallet) {
      const state = generateDiscordMarketplaceLinkState(discordUserId)
      const url = `${getSiteBaseUrl()}/discord-shop/connect?state=${encodeURIComponent(state)}`
      return ephemeral(['**Connect your wallet first** to receive the NFT after payment.', '', url].join('\n'))
    }

    const shopItemOnchain = await getShopItemBySlug(guildId, listingSlug)
    if (
      shopItemOnchain?.status === 'available' &&
      (shopItemOnchain.price_currency === 'SOL' || shopItemOnchain.price_currency === 'OWL')
    ) {
      const currency = shopItemOnchain.price_currency as NftListingCurrency
      const intent = await createNftPurchaseIntent({
        shop_item_id: shopItemOnchain.id,
        discord_user_id: discordUserId,
        buyer_wallet: wallet,
        price_amount: shopItemOnchain.price_amount,
        currency,
      })
      if (!intent) return ephemeral('Could not create payment session.')
      const treasury = getDiscordMarketplacePaymentWalletAddress() ?? '(set DISCORD_MARKETPLACE_PAYMENT_WALLET)'
      const payLine =
        currency === 'SOL'
          ? `Send **exactly ${shopItemOnchain.price_amount} SOL** to \`${treasury}\``
          : `Send **exactly ${shopItemOnchain.price_amount} OWL** to \`${treasury}\``
      return ephemeral(
        [
          `**Purchase — ${shopItemOnchain.display_name}**`,
          '',
          payLine,
          `**Memo (exact):** \`${intent.memo}\``,
          '',
          'Include the memo in the **same transaction** as your payment.',
          '',
          `Quote expires: ${intent.expires_at}`,
          '',
          `Then run \`/owltopia-shop verify-nft signature:<your_tx_signature>\``,
        ].join('\n')
      )
    }

    const listing = await getNftListingBySlug(guildId, listingSlug)
    if (!listing || listing.status !== 'available') {
      return ephemeral(`Listing \`${listingSlug}\` not found or not available.`)
    }

    const intent = await createNftPurchaseIntent({
      listing_id: listing.id,
      discord_user_id: discordUserId,
      buyer_wallet: wallet,
      price_amount: listing.price_amount,
      currency: listing.currency,
    })
    if (!intent) return ephemeral('Could not create payment session.')

    const treasury = getDiscordMarketplacePaymentWalletAddress() ?? '(set DISCORD_MARKETPLACE_PAYMENT_WALLET)'
    const label = listing.display_name ?? listing.nft_mint
    const payLine =
      listing.currency === 'SOL'
        ? `Send **exactly ${listing.price_amount} SOL** to \`${treasury}\``
        : `Send **exactly ${listing.price_amount} OWL** to \`${treasury}\``

    return ephemeral(
      [
        `**NFT purchase — ${label}**`,
        '',
        payLine,
        `**Memo (exact):** \`${intent.memo}\``,
        '',
        'Include the memo in the **same transaction** as your payment (Phantom: Advanced → Memo).',
        '',
        `Quote expires: ${intent.expires_at}`,
        '',
        `Then run \`/owltopia-shop verify-nft signature:<your_tx_signature>\``,
        '',
        `NFT will auto-transfer to \`${wallet.slice(0, 4)}…${wallet.slice(-4)}\` after verification.`,
      ].join('\n')
    )
  }

  if (sub === 'verify-nft') {
    const sig = (strOptions.signature ?? '').trim()
    if (!sig) return ephemeral('Usage: `/owltopia-shop verify-nft signature:<tx>`')

    const wallet = await getWalletAddressByDiscordUserId(discordUserId)
    if (!wallet) {
      return ephemeral('Link your wallet first with `/owltopia-shop connect-wallet`.')
    }

    if (await isNftPaymentSignatureUsed(sig)) {
      return ephemeral('That transaction was already used for a purchase.')
    }

    const connection = getSolanaConnection()
    const tx = await connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })
    if (!tx || tx.meta?.err) {
      return ephemeral('Transaction not found or failed on-chain.')
    }

    const memos = extractOwlShopMemosFromParsedTx(tx)
    let intent = null
    for (const m of memos) {
      const cand = await findNftIntentByMemo(m)
      if (cand && cand.discord_user_id === discordUserId) {
        intent = cand
        break
      }
    }
    if (!intent) {
      return ephemeral(
        'No matching pending NFT purchase. Run `/owltopia-shop buy-nft listing:<slug>` first and include memo `OWLSHOP:…` in your payment.'
      )
    }
    if (new Date(intent.expires_at).getTime() <= Date.now()) {
      return ephemeral('Payment quote expired. Run `/owltopia-shop buy-nft` again.')
    }

    const paymentCheck = await verifyDiscordMarketplaceNftPayment({
      signature: sig,
      currency: intent.currency,
      expectedAmount: intent.price_amount,
      expectedMemo: intent.memo,
      payerWallet: wallet,
      parsedTransaction: tx,
    })
    if (!paymentCheck.ok) {
      return ephemeral(paymentCheck.error)
    }

    await markNftIntentConfirmed(intent.id, sig)

    if (intent.shop_item_id) {
      const delivery = await completeShopItemOnchainSale({
        shop_item_id: intent.shop_item_id,
        recipient_wallet: wallet,
      })
      if (!delivery.ok) {
        return ephemeral(
          `Payment verified but delivery failed (${delivery.error}). Contact support with \`${sig}\`.`
        )
      }
      return embedResponse({
        title: '🎉 Purchase complete!',
        description: [
          'Your item was delivered to your linked wallet.',
          `[Payment](${gen2PresaleExplorerTxUrl(sig)}) · [Delivery](${gen2PresaleExplorerTxUrl(delivery.fulfillmentTx)})`,
        ].join('\n'),
        color: 0x2ecc71,
      })
    }

    const listingById = intent.listing_id ? await getNftListingById(intent.listing_id) : null
    if (!listingById || listingById.discord_guild_id !== guildId) {
      return ephemeral('Listing not found for this server.')
    }
    if (listingById.status !== 'available') {
      return ephemeral('This NFT was already sold.')
    }

    const sale = await completeNftSale({
      listing_id: listingById.id,
      buyer_discord_user_id: discordUserId,
      buyer_wallet: wallet,
      payment_tx_signature: sig,
    })
    if (!sale.ok) {
      return ephemeral(sale.message)
    }

    const delivery = await fulfillMarketplaceNftToBuyer({
      nftMint: sale.nft_mint,
      recipientWallet: wallet,
    })

    if (!delivery.ok) {
      await markNftListingFulfillmentFailed(sale.listing_id, delivery.error)
      return ephemeral(
        `Payment verified but NFT transfer failed (${delivery.error}). Contact support with signature \`${sig}\` — payment is recorded.`
      )
    }

    await markNftListingFulfilled(sale.listing_id, delivery.signature)
    const label = sale.display_name ?? sale.nft_mint
    const shortWallet = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`

    return embedResponse({
      title: '🎉 NFT Purchased!',
      description: [
        `You acquired **${label}**.`,
        '',
        `**Paid:** ${formatNftPrice(sale.price_amount, sale.currency)}`,
        `**Delivered to:** \`${shortWallet}\``,
        `[Payment tx](${gen2PresaleExplorerTxUrl(sig)}) · [Delivery tx](${gen2PresaleExplorerTxUrl(delivery.signature)})`,
      ].join('\n'),
      color: 0x2ecc71,
    })
  }

  if (sub === 'admin') {
    const access = await memberCanManageShop(interaction.member)
    if (!access.ok) return ephemeral(access.message)

    if (nestedSub === 'list-owl') {
      const owlAmount = numOptions.owl
      const points = numOptions.points
      if (!Number.isFinite(owlAmount) || owlAmount <= 0 || !Number.isFinite(points) || points <= 0) {
        return ephemeral('Usage: `/owltopia-shop admin list-owl owl:<amount> points:<cost>`')
      }
      const defaultName = `${owlAmount} OWL`
      const name = (strOptions.name ?? '').trim() || defaultName
      const slug =
        slugifyMarketplaceProductSlug(strOptions.slug ?? `owl-${owlAmount}`) ||
        slugifyMarketplaceProductSlug(defaultName)

      const product = await upsertMarketplaceProduct({
        discord_guild_id: guildId,
        slug,
        name,
        points_cost: Math.trunc(points),
        owl_delivery_amount: owlAmount,
        product_kind: 'owl_tokens',
        active: true,
      })
      if (!product) return ephemeral('Could not save OWL listing (database error).')

      return ephemeral(
        [
          `**OWL listing live:** **${product.owl_delivery_amount} OWL** for **${product.points_cost.toLocaleString()}** points`,
          `Slug: \`${product.slug}\``,
          '',
          'Users buy with `/owltopia-shop buy product:' + product.slug + '` (linked wallet required).',
          'OWL is sent automatically from the marketplace treasury on purchase.',
          '',
          '_Payment currency for OWL bundles is **points** today. SOL/OWL on-chain pricing can be added later if needed._',
        ].join('\n')
      )
    }

    if (nestedSub === 'list-nft') {
      const mint = (strOptions.mint ?? '').trim()
      const price = numOptions.price
      const currency = (strOptions.currency ?? '').trim().toUpperCase() as NftListingCurrency
      const slug = slugifyNftListingSlug(strOptions.slug ?? strOptions.name ?? defaultNftListingSlugFromMint(mint))
      const displayName = (strOptions.name ?? '').trim() || null

      if (!mint || !Number.isFinite(price) || price <= 0) {
        return ephemeral('Usage: `/owltopia-shop admin list-nft mint:… price:… currency:SOL|OWL`')
      }
      if (currency !== 'SOL' && currency !== 'OWL') {
        return ephemeral('Currency must be **SOL** or **OWL**.')
      }

      const escrow = getDiscordMarketplaceNftEscrowAddress()
      if (!escrow) {
        return ephemeral('Marketplace escrow not configured (set DISCORD_MARKETPLACE_ESCROW_SECRET_KEY on the server).')
      }

      const listing = await createNftListing({
        discord_guild_id: guildId,
        listing_slug: slug,
        nft_mint: mint,
        display_name: displayName,
        price_amount: price,
        currency,
        listed_by_discord_user_id: discordUserId,
      })
      if (!listing) return ephemeral('Could not create listing (duplicate slug or database error).')

      return ephemeral(
        [
          `**Listing created** (\`${listing.listing_slug}\`) — **${formatNftPrice(listing.price_amount, listing.currency)}**`,
          '',
          '**Step 1:** Transfer the NFT to marketplace escrow:',
          `\`${escrow}\``,
          '',
          `**Step 2:** Run \`/owltopia-shop admin verify-nft-deposit listing:${listing.listing_slug}\``,
          '',
          `_Mint: \`${mint}\`_`,
        ].join('\n')
      )
    }

    if (nestedSub === 'verify-nft-deposit') {
      const listingSlug = (strOptions.listing ?? '').trim().toLowerCase()
      if (!listingSlug) {
        return ephemeral('Usage: `/owltopia-shop admin verify-nft-deposit listing:<slug>`')
      }
      const listing = await getNftListingBySlug(guildId, listingSlug)
      if (!listing) return ephemeral(`Listing \`${listingSlug}\` not found.`)
      if (listing.status !== 'pending_deposit') {
        return ephemeral(`Listing is \`${listing.status}\`, not pending deposit.`)
      }

      const depositCheck = await verifyNftDepositedInMarketplaceEscrow(listing.nft_mint)
      if (!depositCheck.ok) {
        return ephemeral(depositCheck.error ?? 'NFT not in escrow yet.')
      }

      const depositSig = (strOptions.signature ?? '').trim() || 'escrow-verified'
      const ok = await markNftListingAvailable(listing.id, depositSig)
      if (!ok) return ephemeral('Could not publish listing.')

      return ephemeral(
        `**${listing.display_name ?? listing.listing_slug}** is now **live** for **${formatNftPrice(listing.price_amount, listing.currency)}**.`
      )
    }

    if (nestedSub === 'list-nfts') {
      const listings = await listAllNftListings(guildId)
      if (listings.length === 0) return ephemeral('No NFT listings.')
      const lines = listings.map((n) => {
        const label = n.display_name ?? n.nft_mint.slice(0, 8) + '…'
        return `${nftListingStatusEmoji(n.status)} **${label}** (\`${n.listing_slug}\`) — ${formatNftPrice(n.price_amount, n.currency)} · ${n.status}`
      })
      return ephemeral(['**All NFT listings**', '', ...lines].join('\n'))
    }

    if (nestedSub === 'remove-nft') {
      const listingSlug = (strOptions.listing ?? '').trim().toLowerCase()
      if (!listingSlug) {
        return ephemeral('Usage: `/owltopia-shop admin remove-nft listing:<slug>`')
      }
      const listing = await getNftListingBySlug(guildId, listingSlug)
      if (!listing) return ephemeral('Listing not found.')
      const ok = await removeNftListing(listing.id)
      if (!ok) return ephemeral('Could not remove listing.')
      return ephemeral(
        `Removed listing \`${listingSlug}\`. Retrieve the NFT from escrow manually if it was deposited.`
      )
    }

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
      const lines = products.map((p) => {
        const kind = p.product_kind === 'owl_tokens' ? '🦉' : '📦'
        return `${kind} ${p.active ? '🟢' : '🔴'} **${p.name}** (\`${p.slug}\`) — ${p.points_cost.toLocaleString()} pts${p.owl_delivery_amount > 0 ? `, ${p.owl_delivery_amount} OWL` : ''}`
      })
      return ephemeral(['**All shop products**', '', ...lines].join('\n'))
    }

    return ephemeral(
      'Admin: `list-owl`, `add-product`, `list-nft`, `verify-nft-deposit`, `list-nfts`, `remove-nft`, `grant-points`, `list-products`'
    )
  }

  return ephemeral(
    [
      '**Owltopia Shop**',
      '',
      '`/owltopia-shop browse` — full shop',
      '`/owltopia-shop browse-owl` — OWL bundles (points)',
      '`/owltopia-shop browse-nfts` — NFTs only',
      '`/owltopia-shop buy` — points purchase',
      '`/owltopia-shop buy-nft` — NFT payment quote (SOL/OWL)',
      '`/owltopia-shop verify-nft` — confirm NFT payment + delivery',
      '`/owltopia-shop wallet` — check linked wallet',
      '`/owltopia-shop connect-wallet` — link Solana wallet',
      '`/owltopia-shop balance` — your points',
      '`/owltopia-shop purchases` — order history',
    ].join('\n')
  )
}
