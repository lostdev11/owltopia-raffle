import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { getMetaplexTokenMetadata } from '@/lib/solana/metaplex-mint-onchain-metadata'
import { normalizeWalletNftDisplayName } from '@/lib/raffles/sns-domain-metadata'

/** Title shown in wallet picker and used for NFT prize raffles (name, else mint). */
export function nftPrizeRaffleTitleFromWalletSelection(
  name: string | null | undefined,
  mint: string
): string {
  const normalized = normalizeWalletNftDisplayName(name)
  const mintTrim = mint.trim()
  if (normalized) return normalized
  return mintTrim
}

async function fetchMetadataJsonName(uri: string): Promise<string | null> {
  const trimmed = uri.trim()
  if (!trimmed) return null
  try {
    const res = await fetch(trimmed, { cache: 'force-cache' })
    if (!res.ok) return null
    const json = (await res.json()) as { name?: string }
    const n = normalizeWalletNftDisplayName(json?.name)
    return n || null
  } catch {
    return null
  }
}

/** Resolve NFT display title from chain (Metaplex + off-chain JSON), matching wallet NFT list logic. */
export async function resolveNftPrizeRaffleTitleFromMint(
  connection: Connection,
  mintAddress: string
): Promise<string> {
  const mintTrim = mintAddress.trim()
  let name: string | null = null
  try {
    const meta = await getMetaplexTokenMetadata(connection, new PublicKey(mintTrim))
    if (meta?.name) {
      name = normalizeWalletNftDisplayName(meta.name) || null
    }
    if (meta?.uri) {
      const jsonName = await fetchMetadataJsonName(meta.uri)
      if (jsonName) name = jsonName
    }
  } catch {
    // Fall through to mint address.
  }
  return nftPrizeRaffleTitleFromWalletSelection(name, mintTrim)
}

export function nftPrizeRaffleTitleMatchesSubmitted(
  submittedTitle: string,
  expectedTitle: string
): boolean {
  return (
    normalizeWalletNftDisplayName(submittedTitle) === normalizeWalletNftDisplayName(expectedTitle)
  )
}
