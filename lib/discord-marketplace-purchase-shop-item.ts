import { grantMarketplacePoints } from '@/lib/db/discord-marketplace'
import {
  getShopItemById,
  markShopItemFulfillmentFailed,
  markShopItemSold,
  type DiscordMarketplaceShopItem,
} from '@/lib/db/discord-marketplace-shop-items'
import { fulfillMarketplaceOwlDelivery } from '@/lib/solana/discord-marketplace-fulfill'
import {
  fulfillMarketplaceNftToBuyer,
  fulfillMarketplaceOwlFromEscrow,
} from '@/lib/solana/discord-marketplace-nft-escrow'

export type ShopItemPointsPurchaseResult =
  | { ok: true; fulfillmentTx?: string; message: string }
  | { ok: false; message: string }

export async function purchaseShopItemWithPoints(params: {
  item: DiscordMarketplaceShopItem
  discord_user_id: string
  discord_guild_id: string
  recipient_wallet: string
}): Promise<ShopItemPointsPurchaseResult> {
  const { item } = params
  if (item.price_currency !== 'POINTS') {
    return { ok: false, message: 'This item is not priced in points.' }
  }
  if (item.status !== 'available') {
    return { ok: false, message: 'This item is not available.' }
  }

  const pointsCost = Math.trunc(item.price_amount)
  const next = await grantMarketplacePoints({
    discord_user_id: params.discord_user_id,
    discord_guild_id: params.discord_guild_id,
    delta: -pointsCost,
  })
  if (next == null) {
    return { ok: false, message: 'Not enough points for this purchase.' }
  }

  if (item.deposit_kind === 'none') {
    await markShopItemSold(item.id)
    return { ok: true, message: `Purchased **${item.display_name}** for ${pointsCost.toLocaleString()} points.` }
  }

  if (item.deposit_kind === 'owl_spl') {
    const owlAmount = item.units_per_sale
    let delivery: { ok: true; signature: string } | { ok: false; error: string }
    if (item.treasury_funded) {
      const r = await fulfillMarketplaceOwlDelivery({
        recipientWallet: params.recipient_wallet,
        owlAmountUi: owlAmount,
      })
      if (r.kind === 'sent') delivery = { ok: true, signature: r.signature }
      else if (r.kind === 'failed') delivery = { ok: false, error: r.error }
      else delivery = { ok: false, error: 'OWL treasury not configured' }
    } else {
      delivery = await fulfillMarketplaceOwlFromEscrow({
        recipientWallet: params.recipient_wallet,
        owlAmountUi: owlAmount,
      })
    }

    if (delivery.ok) {
      await markShopItemSold(item.id)
      return {
        ok: true,
        fulfillmentTx: delivery.signature,
        message: `Delivered **${owlAmount} OWL** to your wallet.`,
      }
    }

    await grantMarketplacePoints({
      discord_user_id: params.discord_user_id,
      discord_guild_id: params.discord_guild_id,
      delta: pointsCost,
    })
    await markShopItemFulfillmentFailed(item.id, delivery.error)
    return { ok: false, message: `Delivery failed: ${delivery.error}. Points refunded.` }
  }

  if (item.deposit_kind === 'nft' && item.asset_mint) {
    const delivery = await fulfillMarketplaceNftToBuyer({
      nftMint: item.asset_mint,
      recipientWallet: params.recipient_wallet,
    })
    if (delivery.ok) {
      await markShopItemSold(item.id)
      return {
        ok: true,
        fulfillmentTx: delivery.signature,
        message: `NFT delivered to your wallet.`,
      }
    }
    await grantMarketplacePoints({
      discord_user_id: params.discord_user_id,
      discord_guild_id: params.discord_guild_id,
      delta: pointsCost,
    })
    await markShopItemFulfillmentFailed(item.id, delivery.error)
    return { ok: false, message: `NFT delivery failed: ${delivery.error}. Points refunded.` }
  }

  await grantMarketplacePoints({
    discord_user_id: params.discord_user_id,
    discord_guild_id: params.discord_guild_id,
    delta: pointsCost,
  })
  return { ok: false, message: 'Unsupported item type.' }
}

export async function completeShopItemOnchainSale(params: {
  shop_item_id: string
  recipient_wallet: string
}): Promise<{ ok: true; fulfillmentTx: string } | { ok: false; error: string }> {
  const item = await getShopItemById(params.shop_item_id)
  if (!item || item.status !== 'available') {
    return { ok: false, error: 'Item not available' }
  }

  if (item.deposit_kind === 'nft' && item.asset_mint) {
    const delivery = await fulfillMarketplaceNftToBuyer({
      nftMint: item.asset_mint,
      recipientWallet: params.recipient_wallet,
    })
    if (!delivery.ok) {
      await markShopItemFulfillmentFailed(item.id, delivery.error)
      return { ok: false, error: delivery.error }
    }
    await markShopItemSold(item.id)
    return { ok: true, fulfillmentTx: delivery.signature }
  }

  if (item.deposit_kind === 'owl_spl' && !item.treasury_funded) {
    const delivery = await fulfillMarketplaceOwlFromEscrow({
      recipientWallet: params.recipient_wallet,
      owlAmountUi: item.units_per_sale,
    })
    if (!delivery.ok) {
      await markShopItemFulfillmentFailed(item.id, delivery.error)
      return { ok: false, error: delivery.error }
    }
    await markShopItemSold(item.id)
    return { ok: true, fulfillmentTx: delivery.signature }
  }

  return { ok: false, error: 'On-chain sale not supported for this item type' }
}
