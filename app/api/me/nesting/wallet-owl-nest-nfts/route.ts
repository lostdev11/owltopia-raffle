import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { fetchWalletNftsInCollectionDas } from '@/lib/helius/fetch-wallet-nfts-in-collection'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { ensureTieredOwlStakingPoolsReady } from '@/lib/nesting/gen1-staking-pools'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import {
  resolvePrimaryWalletOwlNestCollectionAddress,
  resolveWalletOwlNestCollectionCandidates,
} from '@/lib/nesting/owl-nest-collection'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import { safeErrorMessage } from '@/lib/safe-error'
import { resolveImageUriFromDasAssetPayload } from '@/lib/nft-helius-image'
import { enrichWalletNestMintsForPool } from '@/lib/nesting/nft-lock-service'
import type { WalletNestMintNestStatus } from '@/lib/nesting/nft-stake-eligibility'
import {
  isNftNestPositionCountedAsNested,
  isPendingNftNestBeforeFreezeConfirmed,
} from '@/lib/nesting/position-lifecycle'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/nesting/wallet-owl-nest-nfts?pool_id=<uuid>
 * Owl Nest NFT mints owned by the signed-in wallet that match the configured collection
 * (pool.collection_key or Owltopia env), including nested / opening / blocked status on each row.
 *
 * nest_status: not_nested | nested | opening | blocked
 * Consumers that only need nestable rows should filter `nest_status === 'not_nested'`.
 *
 * Any SIWS session — not admin-only — so the staking UI can list wallet NFTs once nesting is public.
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

    const poolId = request.nextUrl.searchParams.get('pool_id')?.trim() ?? ''
    if (!poolId || !STAKING_UUID_RE.test(poolId)) {
      return NextResponse.json({ error: 'Valid pool_id query param is required.' }, { status: 400 })
    }

    await ensureTieredOwlStakingPoolsReady()

    const pool = await getStakingPoolById(poolId)
    if (!pool || pool.asset_type !== 'nft') {
      return NextResponse.json({ error: 'Pool not found or not an NFT perch.' }, { status: 404 })
    }

    const collectionCandidates = resolveWalletOwlNestCollectionCandidates(pool)
    const collectionAddress = resolvePrimaryWalletOwlNestCollectionAddress(pool)
    if (collectionCandidates.length === 0) {
      const isGen1 = pool.slug?.startsWith('gen1-owl-')
      const isGen2 = pool.slug?.startsWith('gen2-owl-')
      return NextResponse.json({
        configured: false,
        collectionAddress: null,
        mints: [] as {
          mint: string
          name: string | null
          image: string | null
          nest_status: WalletNestMintNestStatus
        }[],
        message: isGen1
          ? 'Set OWLTOPIA_COLLECTION_ADDRESS in the server environment so Gen 1 owl NFTs can be detected.'
          : isGen2
            ? 'Set NEXT_PUBLIC_GEN2_COLLECTION_MINT in the server environment so Gen 2 owl NFTs can be detected.'
            : 'Set collection_key on this perch or OWLTOPIA_COLLECTION_ADDRESS / NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS so we can find Owl Nest NFTs.',
      })
    }

    const heliusRpcUrl = getHeliusMainnetRpcUrl()
    if (!heliusRpcUrl) {
      return NextResponse.json(
        { error: 'NFT lookup requires HELIUS_API_KEY (Helius RPC).' },
        { status: 503 }
      )
    }

    const wallet = session.wallet

    const itemsByMint = new Map<string, Awaited<ReturnType<typeof fetchWalletNftsInCollectionDas>>[number]>()
    try {
      for (const candidate of collectionCandidates) {
        const batch = await fetchWalletNftsInCollectionDas(heliusRpcUrl, wallet, candidate)
        for (const item of batch) {
          const id = item.id?.trim()
          if (id) itemsByMint.set(id, item)
        }
      }
    } catch {
      return NextResponse.json({ error: 'Failed to fetch wallet NFTs from indexer.' }, { status: 502 })
    }
    const allItems = [...itemsByMint.values()]

    const positions = await listStakingPositionsByWallet(wallet)
    // Any open nest on this wallet (including sibling Gen tiers) marks the mint status.
    const nestedMints = new Set<string>()
    const openingMints = new Set<string>()
    for (const p of positions) {
      const mint = typeof p.asset_identifier === 'string' ? p.asset_identifier.trim() : ''
      if (!mint) continue
      if (isNftNestPositionCountedAsNested(p)) nestedMints.add(mint)
      else if (isPendingNftNestBeforeFreezeConfirmed(p)) openingMints.add(mint)
    }

    const mintRowsRaw = await Promise.all(
      allItems.map(async (item) => {
        const mint = item.id?.trim()
        if (!mint || item.burnt === true) return null

        const content = item.content
        const firstFile = content?.files?.[0]
        // Prefer Helius CDN for Owltopia art — direct `uri` is often gateway.irys.xyz, which
        // mobile browsers and some gateways fail on; metadata-image uses the same preference.
        let image: string | null = firstFile?.cdn_uri ?? firstFile?.uri ?? null
        if (!image) {
          image = await resolveImageUriFromDasAssetPayload(item)
        }
        const name = content?.metadata?.name ?? null
        return { mint, name, image }
      })
    )

    const mintRows = mintRowsRaw.filter((row): row is NonNullable<typeof row> => row !== null)

    mintRows.sort((a, b) => (a.name || a.mint).localeCompare(b.name || b.mint))

    // Skip expensive on-chain enrich for mints already nested or mid-open — status is known from DB.
    const enrichCandidates = mintRows.filter(
      (row) => !nestedMints.has(row.mint) && !openingMints.has(row.mint)
    )
    const enriched = await enrichWalletNestMintsForPool(pool, enrichCandidates, wallet)
    const enrichedByMint = new Map(enriched.map((row) => [row.mint, row]))

    const mints = mintRows.map((row) => {
      if (nestedMints.has(row.mint)) {
        return { ...row, nest_status: 'nested' as const }
      }
      if (openingMints.has(row.mint)) {
        return { ...row, nest_status: 'opening' as const }
      }
      const enrichedRow = enrichedByMint.get(row.mint)
      if (enrichedRow?.stake_blocked === true) {
        return {
          mint: row.mint,
          name: enrichedRow.name ?? row.name,
          image: enrichedRow.image ?? row.image,
          nest_status: 'blocked' as const,
          stake_blocked: true,
          stake_block_reason: enrichedRow.stake_block_reason ?? null,
          stake_block_code: enrichedRow.stake_block_code ?? null,
        }
      }
      return {
        mint: row.mint,
        name: enrichedRow?.name ?? row.name,
        image: enrichedRow?.image ?? row.image,
        nest_status: 'not_nested' as const,
        stake_blocked: false,
        stake_block_reason: null,
        stake_block_code: null,
      }
    })

    return NextResponse.json({
      configured: true,
      collectionAddress,
      mints,
    })
  } catch (e) {
    console.error('[me/nesting/wallet-owl-nest-nfts]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
