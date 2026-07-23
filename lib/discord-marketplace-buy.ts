/**
 * Shared Discord marketplace purchase flows (slash commands + Quick buy buttons).
 */
import { generateDiscordMarketplaceLinkState } from '@/lib/discord-marketplace-link-state'
import {
  discordMarketplacePurchaseFeeLamports,
  formatDiscordMarketplacePurchaseFeeLabel,
  isDiscordMarketplacePurchaseFeeEnabled,
} from '@/lib/discord-marketplace-purchase-fee'
import { purchaseShopItemWithPoints } from '@/lib/discord-marketplace-purchase-shop-item'
import {
  createMarketplaceOrder,
  getMarketplacePointsBalance,
  getMarketplaceProductBySlug,
  markMarketplaceOrderFailed,
  markMarketplaceOrderFulfilled,
  refundMarketplaceOrder,
} from '@/lib/db/discord-marketplace'
import {
  createNftPurchaseIntent,
  getNftListingBySlug,
  type NftListingCurrency,
  type NftPurchaseIntent,
} from '@/lib/db/discord-marketplace-nfts'
import { getShopItemBySlug } from '@/lib/db/discord-marketplace-shop-items'
import { fulfillMarketplaceOwlDelivery } from '@/lib/solana/discord-marketplace-fulfill'
import { getDiscordMarketplacePaymentWalletAddress } from '@/lib/solana/discord-marketplace-payment-wallet'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import { getWalletAddressByDiscordUserId } from '@/lib/db/wallet-profiles'
import { getSiteBaseUrl } from '@/lib/site-config'
import { gen2PresaleExplorerTxUrl } from '@/lib/gen2-presale/explorer'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

export const OWLSHOP_QUICK_BUY_CUSTOM_ID_PREFIX = 'owlshop_qb:'

export type MarketplaceBuyResult =
  | { kind: 'ephemeral'; content: string }
  | { kind: 'embed'; embed: Record<string, unknown> }

function connectWalletMessage(discordUserId: string, purpose: string): string {
  const state = generateDiscordMarketplaceLinkState(discordUserId)
  const url = `${getSiteBaseUrl()}/discord-shop/connect?state=${encodeURIComponent(state)}`
  return [`**Connect your wallet first** ${purpose}`, '', url].join('\n')
}

async function resolvePlatformFeeLamports(): Promise<number> {
  if (!isDiscordMarketplacePurchaseFeeEnabled()) return 0
  const quote = await discordMarketplacePurchaseFeeLamports()
  if (!quote || quote.lamports <= 0n) return 0
  return Number(quote.lamports)
}

export function formatOnchainPaymentInstructions(params: {
  title: string
  currency: NftListingCurrency
  priceAmount: number
  intent: NftPurchaseIntent
  deliverHint?: string
}): string {
  const paymentWallet =
    getDiscordMarketplacePaymentWalletAddress() ?? '(set DISCORD_MARKETPLACE_PAYMENT_WALLET)'
  const feeTreasury = getPlatformFeeTreasuryWalletAddress()
  const feeLamports = Math.max(0, Math.floor(Number(params.intent.platform_fee_lamports ?? 0)))
  const feeLabel = formatDiscordMarketplacePurchaseFeeLabel(
    feeLamports > 0 ? BigInt(feeLamports) : 0n
  )

  const payLine =
    params.currency === 'SOL'
      ? `Send **exactly ${params.priceAmount} SOL** to \`${paymentWallet}\``
      : `Send **exactly ${params.priceAmount} OWL** to \`${paymentWallet}\``

  const lines = [
    `**${params.title}**`,
    '',
    payLine,
    `**Memo (exact):** \`${params.intent.memo}\``,
  ]

  if (feeLamports > 0 && feeTreasury) {
    const feeSol = feeLamports / LAMPORTS_PER_SOL
    const feeSolStr = feeSol >= 0.01 ? feeSol.toFixed(4) : feeSol.toFixed(6)
    if (feeTreasury === paymentWallet && params.currency === 'SOL') {
      const total = params.priceAmount + feeSol
      const totalStr = total >= 0.01 ? total.toFixed(4) : total.toFixed(6)
      lines.push(
        '',
        `**Total SOL (listing + fee):** **${totalStr} SOL** to the same wallet`,
        `Includes ${feeLabel}`
      )
    } else {
      lines.push(
        '',
        `**Platform fee:** send **${feeSolStr} SOL** to \`${feeTreasury}\` in the **same transaction**`,
        `(${feeLabel})`
      )
    }
  }

  lines.push(
    '',
    'Include the memo in the **same transaction** as your payment.',
    '',
    `Quote expires: ${params.intent.expires_at}`,
    '',
    `Then run \`/owltopia-shop verify-nft signature:<your_tx_signature>\``
  )
  if (params.deliverHint) lines.push('', params.deliverHint)
  return lines.join('\n')
}

/** Points checkout for shop items + legacy products. */
export async function marketplaceBuyWithPoints(params: {
  guildId: string
  discordUserId: string
  slug: string
}): Promise<MarketplaceBuyResult> {
  const slug = params.slug.trim().toLowerCase()
  if (!slug) {
    return {
      kind: 'ephemeral',
      content: 'Missing product slug. Run `/owltopia-shop browse` to see items.',
    }
  }

  const wallet = await getWalletAddressByDiscordUserId(params.discordUserId)
  if (!wallet) {
    return {
      kind: 'ephemeral',
      content: connectWalletMessage(params.discordUserId, 'so we can deliver your purchase automatically.'),
    }
  }

  const shopItem = await getShopItemBySlug(params.guildId, slug)
  if (shopItem?.status === 'available' && shopItem.price_currency === 'POINTS') {
    const purchase = await purchaseShopItemWithPoints({
      item: shopItem,
      discord_user_id: params.discordUserId,
      discord_guild_id: params.guildId,
      recipient_wallet: wallet,
    })
    if (!purchase.ok) return { kind: 'ephemeral', content: purchase.message }
    const txLine = purchase.fulfillmentTx
      ? `\n[View delivery](${gen2PresaleExplorerTxUrl(purchase.fulfillmentTx)})`
      : ''
    return {
      kind: 'embed',
      embed: {
        title: '🎉 Shop Purchase!',
        description: [`**${shopItem.display_name}**`, '', purchase.message + txLine].join('\n'),
        color: 0x2ecc71,
      },
    }
  }

  const product = await getMarketplaceProductBySlug(params.guildId, slug)
  if (!product || !product.active) {
    return {
      kind: 'ephemeral',
      content: `Product \`${slug}\` not found. Run \`/owltopia-shop browse\` for available items.`,
    }
  }

  const balance = await getMarketplacePointsBalance(params.discordUserId, params.guildId)
  if (balance < product.points_cost) {
    return {
      kind: 'ephemeral',
      content: `Not enough points. **${product.name}** costs **${product.points_cost.toLocaleString()}** — you have **${balance.toLocaleString()}**.`,
    }
  }

  const orderResult = await createMarketplaceOrder({
    discord_user_id: params.discordUserId,
    discord_guild_id: params.guildId,
    product_id: product.id,
    recipient_wallet: wallet,
  })

  if (!orderResult.ok) {
    return { kind: 'ephemeral', content: orderResult.message }
  }

  if (product.owl_delivery_amount > 0) {
    const delivery = await fulfillMarketplaceOwlDelivery({
      recipientWallet: wallet,
      owlAmountUi: product.owl_delivery_amount,
    })

    if (delivery.kind === 'sent') {
      await markMarketplaceOrderFulfilled(orderResult.order_id, delivery.signature)
      const shortWallet = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
      return {
        kind: 'embed',
        embed: {
          title: '🎉 New Shop Purchase!',
          description: [
            `Congratulations! You acquired **${product.name}**.`,
            '',
            `**Cost:** ${orderResult.points_spent.toLocaleString()} points`,
            `**Delivered:** ${product.owl_delivery_amount} OWL → \`${shortWallet}\``,
            `[View transaction](${gen2PresaleExplorerTxUrl(delivery.signature)})`,
          ].join('\n'),
          color: 0x2ecc71,
        },
      }
    }

    if (delivery.kind === 'failed') {
      await markMarketplaceOrderFailed(orderResult.order_id, delivery.error)
      await refundMarketplaceOrder(orderResult.order_id)
      return {
        kind: 'ephemeral',
        content: `Purchase could not be delivered on-chain (${delivery.error}). Your points were refunded. Contact support if this persists.`,
      }
    }

    await markMarketplaceOrderFulfilled(orderResult.order_id, 'no-on-chain-delivery')
  } else {
    await markMarketplaceOrderFulfilled(orderResult.order_id, 'points-only')
  }

  return {
    kind: 'embed',
    embed: {
      title: '🎉 New Shop Purchase!',
      description: [
        `Congratulations! You acquired **${product.name}**.`,
        '',
        `**Cost:** ${orderResult.points_spent.toLocaleString()} points`,
        product.owl_delivery_amount > 0 ? '' : '_This item does not include on-chain OWL delivery._',
      ]
        .filter(Boolean)
        .join('\n'),
      color: 0x2ecc71,
    },
  }
}

/** Create SOL/OWL payment quote for shop item or NFT listing. */
export async function marketplaceCreateOnchainQuote(params: {
  guildId: string
  discordUserId: string
  slug: string
}): Promise<MarketplaceBuyResult> {
  const listingSlug = params.slug.trim().toLowerCase()
  if (!listingSlug) {
    return { kind: 'ephemeral', content: 'Missing listing slug.' }
  }

  const wallet = await getWalletAddressByDiscordUserId(params.discordUserId)
  if (!wallet) {
    return {
      kind: 'ephemeral',
      content: connectWalletMessage(params.discordUserId, 'to receive the item after payment.'),
    }
  }

  const feeLamports = await resolvePlatformFeeLamports()

  const shopItemOnchain = await getShopItemBySlug(params.guildId, listingSlug)
  if (
    shopItemOnchain?.status === 'available' &&
    (shopItemOnchain.price_currency === 'SOL' || shopItemOnchain.price_currency === 'OWL')
  ) {
    const currency = shopItemOnchain.price_currency as NftListingCurrency
    const intent = await createNftPurchaseIntent({
      shop_item_id: shopItemOnchain.id,
      discord_user_id: params.discordUserId,
      buyer_wallet: wallet,
      price_amount: shopItemOnchain.price_amount,
      currency,
      platform_fee_lamports: feeLamports,
    })
    if (!intent) return { kind: 'ephemeral', content: 'Could not create payment session.' }
    return {
      kind: 'ephemeral',
      content: formatOnchainPaymentInstructions({
        title: `Purchase — ${shopItemOnchain.display_name}`,
        currency,
        priceAmount: shopItemOnchain.price_amount,
        intent,
      }),
    }
  }

  const listing = await getNftListingBySlug(params.guildId, listingSlug)
  if (!listing || listing.status !== 'available') {
    return {
      kind: 'ephemeral',
      content: `Listing \`${listingSlug}\` not found or not available.`,
    }
  }

  const intent = await createNftPurchaseIntent({
    listing_id: listing.id,
    discord_user_id: params.discordUserId,
    buyer_wallet: wallet,
    price_amount: listing.price_amount,
    currency: listing.currency,
    platform_fee_lamports: feeLamports,
  })
  if (!intent) return { kind: 'ephemeral', content: 'Could not create payment session.' }

  const label = listing.display_name ?? listing.nft_mint
  return {
    kind: 'ephemeral',
    content: formatOnchainPaymentInstructions({
      title: `NFT purchase — ${label}`,
      currency: listing.currency,
      priceAmount: listing.price_amount,
      intent,
      deliverHint: `NFT will auto-transfer to \`${wallet.slice(0, 4)}…${wallet.slice(-4)}\` after verification.`,
    }),
  }
}

/**
 * Quick-buy button: instant for POINTS, payment quote for SOL/OWL.
 * custom_id: owlshop_qb:item:{slug} | owlshop_qb:nft:{slug} | owlshop_qb:prod:{slug}
 */
export async function marketplaceQuickBuyFromCustomId(params: {
  guildId: string
  discordUserId: string
  customId: string
}): Promise<MarketplaceBuyResult> {
  const raw = params.customId.trim()
  if (!raw.startsWith(OWLSHOP_QUICK_BUY_CUSTOM_ID_PREFIX)) {
    return { kind: 'ephemeral', content: 'Unknown shop button.' }
  }
  const rest = raw.slice(OWLSHOP_QUICK_BUY_CUSTOM_ID_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon <= 0) return { kind: 'ephemeral', content: 'Invalid shop button.' }
  const kind = rest.slice(0, colon)
  const slug = rest.slice(colon + 1).trim().toLowerCase()
  if (!slug) return { kind: 'ephemeral', content: 'Missing listing slug on button.' }

  if (kind === 'nft') {
    return marketplaceCreateOnchainQuote({
      guildId: params.guildId,
      discordUserId: params.discordUserId,
      slug,
    })
  }

  if (kind === 'item') {
    const item = await getShopItemBySlug(params.guildId, slug)
    if (!item || item.status !== 'available') {
      return { kind: 'ephemeral', content: `Listing \`${slug}\` is no longer available.` }
    }
    if (item.price_currency === 'POINTS') {
      return marketplaceBuyWithPoints({
        guildId: params.guildId,
        discordUserId: params.discordUserId,
        slug,
      })
    }
    return marketplaceCreateOnchainQuote({
      guildId: params.guildId,
      discordUserId: params.discordUserId,
      slug,
    })
  }

  if (kind === 'prod') {
    return marketplaceBuyWithPoints({
      guildId: params.guildId,
      discordUserId: params.discordUserId,
      slug,
    })
  }

  if (kind === 'help') {
    return {
      kind: 'ephemeral',
      content: connectWalletMessage(
        params.discordUserId,
        '— then use **Quick buy** on the listing (or `/owltopia-shop buy`).'
      ),
    }
  }

  return { kind: 'ephemeral', content: 'Unknown shop button kind.' }
}

export function marketplaceBuyResultToInteractionResponse(
  result: MarketplaceBuyResult
): Record<string, unknown> {
  if (result.kind === 'embed') {
    return {
      type: 4,
      data: {
        embeds: [result.embed],
        flags: 64,
      },
    }
  }
  return {
    type: 4,
    data: {
      content: result.content.slice(0, 2000),
      flags: 64,
    },
  }
}

export function quickBuyCustomId(kind: 'item' | 'nft' | 'prod', slug: string): string {
  const id = `${OWLSHOP_QUICK_BUY_CUSTOM_ID_PREFIX}${kind}:${slug.trim().toLowerCase()}`
  return id.slice(0, 100)
}
