/**
 * Discord webhook / bot announce when a marketplace listing goes live.
 * Set DISCORD_WEBHOOK_MARKETPLACE (and optional DISCORD_MARKETPLACE_CHANNEL_ID for Quick buy buttons).
 */
import type { DiscordMarketplaceProduct } from '@/lib/db/discord-marketplace'
import type { DiscordMarketplaceNftListing } from '@/lib/db/discord-marketplace-nfts'
import type { DiscordMarketplaceShopItem } from '@/lib/db/discord-marketplace-shop-items'
import {
  marketplaceFeeFieldValue,
  postMarketplaceListingAnnouncement,
} from '@/lib/discord-marketplace-announce'
import type { DiscordIncomingEmbed } from '@/lib/discord-incoming-webhook'
import { resolveNftPrizeImageForDiscordEmbed } from '@/lib/discord-nft-embed-image'

const EMBED_GOLD = 0xf39c12

function formatShopPrice(amount: number, currency: 'POINTS' | 'SOL' | 'OWL'): string {
  if (currency === 'POINTS') return `${Math.trunc(amount).toLocaleString()} points`
  if (currency === 'SOL') return `${amount} SOL`
  return `${amount} OWL`
}

function formatProductPrice(product: DiscordMarketplaceProduct): string {
  const pts = `${product.points_cost.toLocaleString()} points`
  if (product.owl_delivery_amount > 0) {
    return `${pts} → **${product.owl_delivery_amount} OWL** auto-delivered`
  }
  return pts
}

function shopItemTypeLabel(item: DiscordMarketplaceShopItem): string {
  if (item.deposit_kind === 'nft') return 'NFT'
  if (item.deposit_kind === 'owl_spl') {
    return item.treasury_funded ? 'OWL (treasury)' : 'OWL (escrow)'
  }
  return 'Digital / points'
}

function shopItemBuyHint(item: DiscordMarketplaceShopItem): string {
  if (item.price_currency === 'POINTS') {
    return `/owltopia-shop buy product:${item.slug}`
  }
  if (item.deposit_kind === 'nft' || item.price_currency === 'SOL' || item.price_currency === 'OWL') {
    return `/owltopia-shop buy-nft listing:${item.slug}`
  }
  return `/owltopia-shop browse`
}

function withFeeField(
  fields: NonNullable<DiscordIncomingEmbed['fields']>,
  onchain: boolean
): NonNullable<DiscordIncomingEmbed['fields']> {
  if (!onchain) return fields
  const fee = marketplaceFeeFieldValue()
  if (!fee) return fields
  return [...fields, { name: 'Platform fee', value: fee, inline: false }]
}

/** Fire-and-forget — listing save must not fail on Discord. */
export function notifyMarketplaceShopItemLive(item: DiscordMarketplaceShopItem): void {
  if (item.status !== 'available') return
  void (async () => {
    const onchain = item.price_currency === 'SOL' || item.price_currency === 'OWL'
    const embed: DiscordIncomingEmbed = {
      title: item.display_name,
      description: item.description?.trim() || 'Now available in the Owltopia shop.',
      color: EMBED_GOLD,
      fields: withFeeField(
        [
          { name: 'Price', value: formatShopPrice(item.price_amount, item.price_currency), inline: true },
          { name: 'Type', value: shopItemTypeLabel(item), inline: true },
          { name: 'Slug', value: `\`${item.slug}\``, inline: true },
          {
            name: 'How to buy',
            value: onchain
              ? `Tap **Quick buy** or \`${shopItemBuyHint(item)}\``
              : `Tap **Quick buy** (instant if you have points) or \`${shopItemBuyHint(item)}\``,
            inline: false,
          },
          {
            name: 'First step',
            value: 'Link wallet once: `/owltopia-shop connect-wallet`',
            inline: false,
          },
        ],
        onchain
      ),
      timestamp: new Date().toISOString(),
    }

    if (item.deposit_kind === 'nft' && item.asset_mint) {
      const image = await resolveNftPrizeImageForDiscordEmbed(item.asset_mint, null)
      if (image) embed.thumbnail = { url: image }
    }

    await postMarketplaceListingAnnouncement({
      embed,
      quickBuy: { kind: 'item', slug: item.slug },
    })
  })()
}

export function notifyMarketplaceProductLive(product: DiscordMarketplaceProduct): void {
  if (!product.active) return
  void (async () => {
    const type =
      product.product_kind === 'owl_tokens'
        ? 'OWL bundle'
        : product.owl_delivery_amount > 0
          ? 'Points + OWL'
          : 'Points item'

    const embed: DiscordIncomingEmbed = {
      title: product.name,
      description: product.description?.trim() || 'Now available in the Owltopia shop.',
      color: EMBED_GOLD,
      fields: [
        { name: 'Price', value: formatProductPrice(product), inline: true },
        { name: 'Type', value: type, inline: true },
        { name: 'Slug', value: `\`${product.slug}\``, inline: true },
        {
          name: 'How to buy',
          value: `Tap **Quick buy** (needs linked wallet + points) or \`/owltopia-shop buy product:${product.slug}\``,
          inline: false,
        },
        {
          name: 'First step',
          value: 'Link wallet once: `/owltopia-shop connect-wallet`',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    }

    await postMarketplaceListingAnnouncement({
      embed,
      quickBuy: { kind: 'prod', slug: product.slug },
    })
  })()
}

export function notifyMarketplaceNftListingLive(listing: DiscordMarketplaceNftListing): void {
  if (listing.status !== 'available') return
  void (async () => {
    const label = listing.display_name ?? listing.listing_slug
    const price =
      listing.currency === 'SOL'
        ? `${listing.price_amount} SOL`
        : `${listing.price_amount} OWL`

    const embed: DiscordIncomingEmbed = {
      title: label,
      description: 'NFT listing is live in the Owltopia shop.',
      color: EMBED_GOLD,
      fields: withFeeField(
        [
          { name: 'Price', value: price, inline: true },
          { name: 'Type', value: 'NFT', inline: true },
          { name: 'Listing', value: `\`${listing.listing_slug}\``, inline: true },
          {
            name: 'Mint',
            value: `\`${listing.nft_mint}\``,
            inline: false,
          },
          {
            name: 'How to buy',
            value: `Tap **Quick buy** or \`/owltopia-shop buy-nft listing:${listing.listing_slug}\``,
            inline: false,
          },
          {
            name: 'First step',
            value: 'Link wallet once: `/owltopia-shop connect-wallet`',
            inline: false,
          },
        ],
        true
      ),
      timestamp: new Date().toISOString(),
    }

    const image = await resolveNftPrizeImageForDiscordEmbed(listing.nft_mint, null)
    if (image) embed.thumbnail = { url: image }

    await postMarketplaceListingAnnouncement({
      embed,
      quickBuy: { kind: 'nft', slug: listing.listing_slug },
    })
  })()
}
