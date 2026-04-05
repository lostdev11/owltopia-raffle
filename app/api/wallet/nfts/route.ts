import { NextRequest, NextResponse } from 'next/server'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Helius DAS asset item (NFT) - minimal shape we need */
interface HeliusAsset {
  id?: string
  content?: {
    json_uri?: string
    metadata?: { name?: string }
    files?: Array<{ uri?: string; cdn_uri?: string }>
  }
  grouping?: Array<{ group_key?: string; group_value?: string }>
}

/** Parsed token account info from getParsedTokenAccountsByOwner */
interface ParsedTokenAccountInfo {
  mint?: string
  delegate?: string
  tokenAmount?: { decimals?: number; amount?: string }
}

/** Parse one page of getParsedTokenAccountsByOwner into WalletNft list. */
function parseTokenAccountsToNfts(
  value: Array<{ pubkey?: string; account?: { data?: { parsed?: { info?: ParsedTokenAccountInfo } } } }>
): WalletNft[] {
  const nfts: WalletNft[] = []
  for (const item of value) {
    const info = item.account?.data?.parsed?.info
    if (!info?.mint) continue
    const decimals = Number(info.tokenAmount?.decimals ?? 9)
    const amount = String(info.tokenAmount?.amount ?? '0')
    const isNft =
      amount !== '0' && (decimals === 0 || parseFloat(amount) === 1)
    if (!isNft) continue
    const tokenAccount = item.pubkey ?? info.mint
    nfts.push({
      mint: info.mint,
      tokenAccount,
      amount,
      decimals,
      metadataUri: null,
      name: null,
      image: null,
      collectionName: null,
    })
  }
  return nfts
}

/**
 * On devnet, Helius DAS may return no assets. Fallback: use getParsedTokenAccountsByOwner
 * for both SPL Token and Token-2022 to find NFT token accounts (minimal WalletNft list, no metadata).
 */
async function getNftsViaRpcFallback(rpcUrl: string, wallet: string): Promise<WalletNft[]> {
  const programIds = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]
  const seenMints = new Set<string>()
  const nfts: WalletNft[] = []
  try {
    for (const programId of programIds) {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `parsed-token-accounts-nfts-${programId.toBase58().slice(0, 8)}`,
          method: 'getParsedTokenAccountsByOwner',
          params: [wallet, { programId: programId.toBase58() }],
        }),
        cache: 'no-store',
      })
      if (!res.ok) continue
      const json = await res.json().catch(() => null)
      const value = json?.result?.value as Array<{
        pubkey?: string
        account?: { data?: { parsed?: { info?: ParsedTokenAccountInfo } } }
      }> | undefined
      if (!Array.isArray(value)) continue
      for (const nft of parseTokenAccountsToNfts(value)) {
        if (seenMints.has(nft.mint)) continue
        seenMints.add(nft.mint)
        nfts.push(nft)
      }
    }
    return nfts
  } catch {
    return []
  }
}

/**
 * GET /api/wallet/nfts?wallet=<address>
 * Returns NFTs owned by the wallet using Helius DAS getAssetsByOwner when HELIUS_API_KEY is set.
 * On devnet, if DAS returns none, falls back to getParsedTokenAccountsByOwner so NFTs still show.
 * Raffle creation only rejects staked/delegated SPL holdings (see POST /api/raffles); listing is not filtered by blocklist.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const wallet = searchParams.get('wallet')?.trim()

    if (!wallet) {
      return NextResponse.json(
        { error: 'Missing wallet. Provide ?wallet=<address>.' },
        { status: 400 }
      )
    }

    const heliusRpcUrl = getHeliusRpcUrl()
    if (!heliusRpcUrl) {
      return NextResponse.json(
        { error: 'NFT API not configured (HELIUS_API_KEY)' },
        { status: 503 }
      )
    }

    const isDevnet = /devnet/i.test(heliusRpcUrl)

    // Paginate to fetch more NFTs (up to 10 pages × 1000 = 10,000)
    const limitPerPage = 1000
    const maxPages = 10
    const allItems: HeliusAsset[] = []
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetch(heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `wallet-nfts-${page}`,
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: wallet,
            page,
            limit: limitPerPage,
            options: {
              showFungible: false,
              showNativeBalance: false,
              showZeroBalance: false,
              showInscription: false,
              showGrandTotal: false,
            },
          },
        }),
        cache: 'no-store',
      })

      if (!res.ok) {
        console.error('Helius getAssetsByOwner non-OK', res.status)
        return NextResponse.json(
          { error: 'Failed to fetch NFTs' },
          { status: 502 }
        )
      }

      const json: { result?: { items?: HeliusAsset[] }; error?: { message?: string } } =
        await res.json().catch(() => ({}))
      if (json.error) {
        console.error('Helius getAssetsByOwner error', json.error)
        return NextResponse.json(
          { error: json.error.message || 'Failed to fetch NFTs' },
          { status: 502 }
        )
      }

      const pageItems: HeliusAsset[] = Array.isArray(json.result?.items) ? json.result.items : []
      allItems.push(...pageItems)
      if (pageItems.length < limitPerPage) break
    }

    const items = allItems
    let nfts: WalletNft[] = items
      .filter((item) => item.id)
      .map((item) => {
        const mint = item.id!
        const content = item.content
        const jsonUri = content?.json_uri ?? null
        const firstFile = content?.files?.[0]
        // Prefer direct uri over cdn_uri: Helius CDN proxy often gets 403 from hosts like jpegs.fun
        const image = firstFile?.uri ?? firstFile?.cdn_uri ?? null
        const name = content?.metadata?.name ?? null
        // DAS grouping has collection address, not name; leave collectionName null
        const collectionName: string | null = null

        return {
          mint,
          tokenAccount: mint,
          amount: '1',
          decimals: 0,
          metadataUri: jsonUri,
          name,
          image,
          collectionName,
        }
      })

    // On devnet, Helius DAS often returns no assets; use RPC getParsedTokenAccountsByOwner as fallback
    if (nfts.length === 0 && isDevnet) {
      const rpcFallback = await getNftsViaRpcFallback(heliusRpcUrl, wallet)
      if (rpcFallback.length > 0) nfts = rpcFallback
    }

    return NextResponse.json(nfts, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error) {
    console.error('Error fetching wallet NFTs:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
