import { Connection, PublicKey } from '@solana/web3.js'
import { getTokenInfo } from '@/lib/tokens'
import { OWLTOPIA_COLLECTION_ADDRESS } from '@/lib/config/raffles'

const OWNS_OWLTOPIA_CACHE_TTL_MS = 45_000

const ownsOwltopiaCache = new Map<string, { value: boolean; expiresAt: number }>()

function getSolanaRpcUrl(): string {
  let rpcUrl =
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    'https://api.mainnet-beta.solana.com'

  if (rpcUrl && !rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
    if (!rpcUrl.includes('://')) {
      rpcUrl = `https://${rpcUrl}`
    } else {
      rpcUrl = 'https://api.mainnet-beta.solana.com'
    }
  }

  return rpcUrl
}

export type OwnsOwltopiaOptions = {
  /** When true, always verify against chain/DAS and do not use cache. Use for dashboard and when setting raffle fee. */
  skipCache?: boolean
}

/**
 * Check whether a wallet currently owns an NFT from the Owltopia collection.
 *
 * - Runs server-side only.
 * - Uses Helius DAS getAssetsByOwner when HELIUS_API_KEY is configured.
 * - Falls back to Solana RPC OWL SPL token balance check when Helius is unavailable.
 * - Validates wallet address format; invalid addresses return false.
 * - Pass { skipCache: true } to force a fresh verification (e.g. dashboard load, creating a raffle).
 */
export async function ownsOwltopia(
  walletAddress: string,
  options?: OwnsOwltopiaOptions
): Promise<boolean> {
  const normalized = walletAddress.trim()
  if (!normalized) return false

  const now = Date.now()
  if (!options?.skipCache) {
    const cached = ownsOwltopiaCache.get(normalized)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }
  }

  // On devnet, OWL mint does not exist; skip RPC check to avoid "could not find mint"
  const rpcUrl = getSolanaRpcUrl()
  if (/devnet/i.test(rpcUrl)) {
    ownsOwltopiaCache.set(normalized, {
      value: false,
      expiresAt: Date.now() + OWNS_OWLTOPIA_CACHE_TTL_MS,
    })
    return false
  }

  // Validate wallet address format up front
  let ownerPubkey: PublicKey
  try {
    ownerPubkey = new PublicKey(normalized)
  } catch {
    return false
  }

  const collectionAddress = OWLTOPIA_COLLECTION_ADDRESS?.trim()

  // 1) Try Helius DAS getAssetsByOwner when API key + collection address are configured
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  if (heliusApiKey && collectionAddress && collectionAddress !== 'REPLACE_WITH_COLLECTION') {
    try {
      const limit = 1000
      const maxPages = 5
      const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`

      for (let page = 1; page <= maxPages; page++) {
        const res = await fetch(heliusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `owltopia-ownership-${page}`,
            method: 'getAssetsByOwner',
            params: {
              ownerAddress: normalized,
              page,
              limit,
              options: {
                showFungible: false,
                showGrandTotal: false,
                showInscription: false,
                showNativeBalance: false,
                showZeroBalance: false,
                showUnverifiedCollections: true,
              },
            },
          }),
        })

        if (!res.ok) {
          console.error('Helius getAssetsByOwner returned non-OK status', res.status)
          break
        }

        const json: any = await res.json().catch(() => null)
        const items: any[] | undefined = json?.result?.items
        if (!Array.isArray(items)) break

        for (const item of items) {
          const grouping: any[] | undefined = item?.grouping
          if (Array.isArray(grouping)) {
            const inCollection = grouping.some(
              (g) =>
                g?.group_key === 'collection' &&
                typeof g.group_value === 'string' &&
                g.group_value === collectionAddress,
            )
            if (inCollection) {
              ownsOwltopiaCache.set(normalized, {
                value: true,
                expiresAt: now + OWNS_OWLTOPIA_CACHE_TTL_MS,
              })
              return true
            }
          }
        }

        if (items.length < limit) {
          // Successfully checked all pages; no Owltopia NFT found
          ownsOwltopiaCache.set(normalized, {
            value: false,
            expiresAt: now + OWNS_OWLTOPIA_CACHE_TTL_MS,
          })
          return false
        }
      }
      // Helius failed or error: fall through to OWL SPL fallback
    } catch (err) {
      console.error('Helius getAssetsByOwner failed, falling back to Solana RPC:', err)
    }
  }

  // 2) Fallback: Solana RPC OWL SPL token balance check
  const owlInfo = getTokenInfo('OWL')
  if (!owlInfo.mintAddress) return false

  try {
    const rpcUrl = getSolanaRpcUrl()
    const connection = new Connection(rpcUrl, 'confirmed')

    const mint = new PublicKey(owlInfo.mintAddress)

    const accounts = await connection.getParsedTokenAccountsByOwner(ownerPubkey, { mint })
    for (const acc of accounts.value) {
      const info = (acc.account.data as any)?.parsed?.info
      const amountStr: string | undefined = info?.tokenAmount?.amount
      if (!amountStr) continue
      try {
        const raw = BigInt(amountStr)
        if (raw > 0n) {
          const value = true
          ownsOwltopiaCache.set(normalized, {
            value,
            expiresAt: now + OWNS_OWLTOPIA_CACHE_TTL_MS,
          })
          return value
        }
      } catch {
        continue
      }
    }

    const value = false
    ownsOwltopiaCache.set(normalized, {
      value,
      expiresAt: now + OWNS_OWLTOPIA_CACHE_TTL_MS,
    })
    return value
  } catch (err) {
    console.error('Error checking Owltopia ownership via Solana RPC:', err)
    // On verification failure: log and default to "not a holder"
    const value = false
    ownsOwltopiaCache.set(normalized, {
      value,
      expiresAt: now + OWNS_OWLTOPIA_CACHE_TTL_MS,
    })
    return value
  }
}

