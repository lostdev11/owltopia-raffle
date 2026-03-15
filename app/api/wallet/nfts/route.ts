import { NextRequest, NextResponse } from 'next/server'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { getScamBlocklist, isBlocked } from '@/lib/scam-blocklist'

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

/** Return Helius RPC URL for the current network (mainnet or devnet from env). */
function getHeliusRpcUrl(): string | null {
  const heliusKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusKey) return null
  const solanaUrl = (process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '').trim()
  const isDevnet = /devnet/i.test(solanaUrl)
  const base = isDevnet ? 'https://devnet.helius-rpc.com' : 'https://mainnet.helius-rpc.com'
  return `${base}/?api-key=${encodeURIComponent(heliusKey)}`
}

/**
 * Get mint addresses of NFTs that have a delegate set (e.g. staked) via RPC.
 * No external API needed – uses on-chain token account data.
 */
async function getDelegatedMints(wallet: string): Promise<Set<string>> {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || getHeliusRpcUrl()
  if (!rpcUrl) return new Set<string>()
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'parsed-token-accounts',
        method: 'getParsedTokenAccountsByOwner',
        params: [wallet, { programId: TOKEN_PROGRAM_ID.toBase58() }],
      }),
      cache: 'no-store',
    })
    if (!res.ok) return new Set<string>()
    const json = await res.json().catch(() => null)
    const value = json?.result?.value as Array<{ account?: { data?: { parsed?: { info?: ParsedTokenAccountInfo } } } }> | undefined
    if (!Array.isArray(value)) return new Set<string>()
    const delegated = new Set<string>()
    for (const item of value) {
      const info = item.account?.data?.parsed?.info
      if (!info?.mint) continue
      const decimals = Number(info.tokenAmount?.decimals ?? 9)
      const amount = String(info.tokenAmount?.amount ?? '0')
      const isNft = amount !== '0' && (decimals === 0 || parseFloat(amount) === 1)
      if (!isNft) continue
      const delegate = info.delegate
      if (delegate && typeof delegate === 'string' && delegate !== '') delegated.add(info.mint)
    }
    return delegated
  } catch {
    return new Set<string>()
  }
}

/**
 * Optional: fetch staked mint list from external API when STAKED_NFTS_API_URL is set.
 * URL may contain {wallet} placeholder. Response may be string[] or { mints?: string[] }.
 */
async function getStakedMintsFromApi(wallet: string): Promise<Set<string>> {
  const urlTemplate = process.env.STAKED_NFTS_API_URL?.trim()
  if (!urlTemplate) return new Set<string>()
  const url = urlTemplate.replace('{wallet}', encodeURIComponent(wallet))
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return new Set<string>()
    const data = await res.json().catch(() => null)
    if (Array.isArray(data)) return new Set(data.filter((m: unknown) => typeof m === 'string'))
    if (data && Array.isArray(data.mints)) return new Set(data.mints.filter((m: unknown) => typeof m === 'string'))
    return new Set<string>()
  } catch {
    return new Set<string>()
  }
}

/**
 * On devnet, Helius DAS may return no assets. Fallback: use getParsedTokenAccountsByOwner
 * to find NFT token accounts and return minimal WalletNft list (no metadata).
 */
async function getNftsViaRpcFallback(
  rpcUrl: string,
  wallet: string,
  delegatedMints: Set<string>
): Promise<WalletNft[]> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'parsed-token-accounts-nfts',
        method: 'getParsedTokenAccountsByOwner',
        params: [wallet, { programId: TOKEN_PROGRAM_ID.toBase58() }],
      }),
      cache: 'no-store',
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null)
    const value = json?.result?.value as Array<{
      pubkey?: string
      account?: { data?: { parsed?: { info?: ParsedTokenAccountInfo } } }
    }> | undefined
    if (!Array.isArray(value)) return []
    const nfts: WalletNft[] = []
    for (const item of value) {
      const info = item.account?.data?.parsed?.info
      if (!info?.mint) continue
      if (delegatedMints.has(info.mint)) continue
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
  } catch {
    return []
  }
}

/**
 * GET /api/wallet/nfts?wallet=<address>
 * Returns NFTs owned by the wallet using Helius DAS getAssetsByOwner when HELIUS_API_KEY is set.
 * On devnet, if DAS returns none, falls back to getParsedTokenAccountsByOwner so NFTs still show.
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

    // Paginate to fetch more NFTs (up to 3 pages × 1000 = 3000)
    const limitPerPage = 1000
    const maxPages = 3
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
    const [delegatedMints, stakedMintsFromApi, scamBlocklist] = await Promise.all([
      getDelegatedMints(wallet),
      getStakedMintsFromApi(wallet),
      getScamBlocklist(),
    ])
    const excludeMints = new Set([...delegatedMints, ...stakedMintsFromApi])
    const isScam = (item: HeliusAsset) => {
      if (!item.id) return true
      if (excludeMints.has(item.id)) return true
      if (isBlocked(scamBlocklist, item.id)) return true
      const grouping = item.grouping
      if (Array.isArray(grouping)) {
        for (const g of grouping) {
          if (g?.group_key === 'collection' && g.group_value && isBlocked(scamBlocklist, g.group_value)) return true
        }
      }
      return false
    }
    let nfts: WalletNft[] = items
      .filter((item) => item.id && !isScam(item))
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
      const rpcFallback = await getNftsViaRpcFallback(
        heliusRpcUrl,
        wallet,
        excludeMints
      )
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
