import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { fetchWalletNftsInCollectionDas } from '@/lib/helius/fetch-wallet-nfts-in-collection'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { resolveWalletOwlNestCollectionAddress } from '@/lib/nesting/owl-nest-collection'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import { safeErrorMessage } from '@/lib/safe-error'
import { resolveImageUriFromDasAssetPayload } from '@/lib/nft-helius-image'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/nesting/wallet-owl-nest-nfts?pool_id=<uuid>
 * Owl Nest NFT mints owned by the signed-in wallet that match the configured collection
 * (pool.collection_key or Owltopia env), excluding mints already in an active nest position.
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

    const pool = await getStakingPoolById(poolId)
    if (!pool || pool.asset_type !== 'nft') {
      return NextResponse.json({ error: 'Pool not found or not an NFT perch.' }, { status: 404 })
    }

    const collectionAddress = (pool.collection_key?.trim() || resolveWalletOwlNestCollectionAddress()).trim()
    if (!collectionAddress) {
      return NextResponse.json({
        configured: false,
        collectionAddress: null,
        mints: [] as { mint: string; name: string | null; image: string | null }[],
        message:
          'Set collection_key on this perch or OWLTOPIA_COLLECTION_ADDRESS / NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS so we can find Owl Nest NFTs.',
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

    let allItems: Awaited<ReturnType<typeof fetchWalletNftsInCollectionDas>>
    try {
      allItems = await fetchWalletNftsInCollectionDas(heliusRpcUrl, wallet, collectionAddress)
    } catch {
      return NextResponse.json({ error: 'Failed to fetch wallet NFTs from indexer.' }, { status: 502 })
    }

    const positions = await listStakingPositionsByWallet(wallet)
    const alreadyNested = new Set<string>(
      positions
        .filter((p) => p.status === 'active' && typeof p.asset_identifier === 'string' && p.asset_identifier.trim())
        .map((p) => p.asset_identifier!.trim()),
    )

    const mintRows = await Promise.all(
      allItems.map(async (item) => {
        const mint = item.id?.trim()
        if (!mint || item.burnt === true) return null
        if (alreadyNested.has(mint)) return null

        const content = item.content
        const firstFile = content?.files?.[0]
        let image: string | null = firstFile?.uri ?? firstFile?.cdn_uri ?? null
        if (!image) {
          image = await resolveImageUriFromDasAssetPayload(item)
        }
        const name = content?.metadata?.name ?? null
        return { mint, name, image }
      })
    )

    const mints = mintRows.filter((row): row is NonNullable<typeof row> => row !== null)

    mints.sort((a, b) => (a.name || a.mint).localeCompare(b.name || b.mint))

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
