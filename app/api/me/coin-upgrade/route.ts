import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { fetchWalletNftsInCollectionDas } from '@/lib/helius/fetch-wallet-nfts-in-collection'
import { resolveImageUriFromDasAssetPayload } from '@/lib/nft-helius-image'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { isNftNestPositionCountedAsNested } from '@/lib/nesting/position-lifecycle'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  getCoinArtUpgradeFeeLamports,
  getCoinArtUpgradeFeeSol,
  getCoinArtUpgradeRewardMultiplier,
  isCoinArtUpgradeEnabled,
  MAX_COIN_ART_UPGRADES_PER_REQUEST,
} from '@/lib/coin-upgrade/config'
import { coinUpgradeCollectionCandidates, executeCoinArtUpgrade } from '@/lib/coin-upgrade/service'
import {
  countCoinArtUpgradeCatalogEntries,
  listCoinArtUpgradeCatalogEntries,
  listCoinArtUpgradeCatalogPreviewSamples,
  listCoinArtUpgradesByAssetIds,
  type CoinArtUpgradePreviewSample,
} from '@/lib/db/coin-art-upgrades'
import { getCoinArtUpgradeFeeSplitConfig } from '@/lib/coin-upgrade/fee-split'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

export type CoinArtUpgradeWalletCoin = {
  mint: string
  name: string | null
  image: string | null
  new_image: string | null
  nested: boolean
  /** none = upgradable; processing = paid, on-chain update completing; upgraded = done. */
  upgrade_status: 'none' | 'processing' | 'upgraded' | 'art_unavailable'
}

export type CoinArtUpgradeFeeSplitPublic = {
  wallet_a: string
  wallet_b: string
  percent_a: number
  percent_b: number
}

export type CoinArtUpgradePublicConfig = {
  enabled: boolean
  catalog_ready: boolean
  /** True when upgrades are not sellable yet (flag off and/or catalog empty). */
  preview: boolean
  /** True when holders can select coins and pay. */
  sellable: boolean
  fee_sol: number
  fee_lamports: number
  fee_split: CoinArtUpgradeFeeSplitPublic | null
  reward_multiplier: number
  max_per_request: number
}

async function buildCoinArtUpgradePublicConfig(): Promise<CoinArtUpgradePublicConfig> {
  const enabled = isCoinArtUpgradeEnabled()
  const catalogSize = await countCoinArtUpgradeCatalogEntries()
  const catalogReady = catalogSize > 0
  const split = getCoinArtUpgradeFeeSplitConfig()
  const sellable = enabled && catalogReady && split != null
  return {
    enabled,
    catalog_ready: catalogReady,
    preview: !sellable,
    sellable,
    fee_sol: getCoinArtUpgradeFeeSol(),
    fee_lamports: getCoinArtUpgradeFeeLamports(),
    fee_split: split
      ? {
          wallet_a: split.walletA,
          wallet_b: split.walletB,
          percent_a: split.percentA,
          percent_b: split.percentB,
        }
      : null,
    reward_multiplier: getCoinArtUpgradeRewardMultiplier(),
    max_per_request: MAX_COIN_ART_UPGRADES_PER_REQUEST,
  }
}

/**
 * GET /api/me/coin-upgrade
 * Art upgrade config + the signed-in wallet's Owltopia coins with per-coin
 * upgrade status (works for nested coins — the freeze lock is non-custodial).
 * When not sellable yet, returns Coming soon config without a Helius coin scan.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const config = await buildCoinArtUpgradePublicConfig()

    if (!config.sellable) {
      const previewArt: CoinArtUpgradePreviewSample[] = config.catalog_ready
        ? await listCoinArtUpgradeCatalogPreviewSamples(8)
        : []
      return NextResponse.json({
        config,
        coins: [] as CoinArtUpgradeWalletCoin[],
        preview_art: previewArt,
      })
    }

    const heliusRpcUrl = getHeliusMainnetRpcUrl()
    if (!heliusRpcUrl) {
      return NextResponse.json(
        { error: 'Coin lookup requires HELIUS_API_KEY (Helius RPC).' },
        { status: 503 }
      )
    }

    const wallet = session.wallet
    const itemsByMint = new Map<string, Awaited<ReturnType<typeof fetchWalletNftsInCollectionDas>>[number]>()
    try {
      for (const candidate of coinUpgradeCollectionCandidates()) {
        const batch = await fetchWalletNftsInCollectionDas(heliusRpcUrl, wallet, candidate)
        for (const item of batch) {
          const id = item.id?.trim()
          if (id) itemsByMint.set(id, item)
        }
      }
    } catch {
      return NextResponse.json({ error: 'Failed to fetch wallet NFTs from indexer.' }, { status: 502 })
    }

    const mints = [...itemsByMint.keys()]
    const [catalogEntries, upgradeRows, positions] = await Promise.all([
      listCoinArtUpgradeCatalogEntries(mints),
      listCoinArtUpgradesByAssetIds(mints),
      listStakingPositionsByWallet(wallet),
    ])
    const catalogByMint = new Map(catalogEntries.map((e) => [e.asset_id, e]))
    const upgradeByMint = new Map(upgradeRows.map((r) => [r.asset_id, r]))
    const nestedMints = new Set(
      positions
        .filter((p) => isNftNestPositionCountedAsNested(p))
        .map((p) => p.asset_identifier?.trim() || '')
        .filter(Boolean)
    )

    const coins: CoinArtUpgradeWalletCoin[] = []
    for (const [mint, item] of itemsByMint) {
      if (item.burnt === true) continue
      const content = item.content
      const firstFile = content?.files?.[0]
      let image: string | null = firstFile?.cdn_uri ?? firstFile?.uri ?? null
      if (!image) {
        image = await resolveImageUriFromDasAssetPayload(item)
      }
      const catalog = catalogByMint.get(mint)
      const upgrade = upgradeByMint.get(mint)
      coins.push({
        mint,
        name: content?.metadata?.name ?? catalog?.name ?? null,
        image,
        new_image: catalog?.new_image_uri ?? null,
        nested: nestedMints.has(mint),
        upgrade_status: upgrade
          ? upgrade.status === 'updated'
            ? 'upgraded'
            : 'processing'
          : catalog
            ? 'none'
            : 'art_unavailable',
      })
    }

    coins.sort((a, b) => (a.name || a.mint).localeCompare(b.name || b.mint))

    return NextResponse.json({ config, coins, preview_art: [] as CoinArtUpgradePreviewSample[] })
  } catch (e) {
    console.error('[me/coin-upgrade GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * POST /api/me/coin-upgrade
 * Body: { asset_ids: string[], payment_signature?: string }
 * Verifies the 0.5 SOL × N fee transfer (50/50 founder-wallet split), records it consume-once, then
 * repoints each coin's Core URI to the new art and applies the reward boost.
 * Retries for already-paid coins do not need a new payment signature.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)
    const result = await executeCoinArtUpgrade({
      wallet: session.wallet,
      rawAssetIds: body?.asset_ids,
      paymentSignature: body?.payment_signature,
    })

    return NextResponse.json({
      upgraded: result.upgraded.map((r) => ({
        asset_id: r.asset_id,
        status: r.status,
        update_tx_signature: r.update_tx_signature,
        new_uri: r.new_uri,
      })),
      pending: result.pending,
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[me/coin-upgrade POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
