import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { fetchNftMintMetaFromHelius } from '@/lib/nft-helius-image'
import { getMetaplexTokenMetadata } from '@/lib/solana/metaplex-mint-onchain-metadata'
import { normalizeWalletNftDisplayName } from '@/lib/raffles/sns-domain-metadata'

const METADATA_JSON_TIMEOUT_MS = 3_500

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

function pushUniqueTitleCandidate(candidates: string[], title: string): void {
  const normalized = normalizeWalletNftDisplayName(title)
  if (!normalized) return
  if (candidates.some((candidate) => normalizeWalletNftDisplayName(candidate) === normalized)) return
  candidates.push(title)
}

async function fetchMetadataJsonName(uri: string): Promise<string | null> {
  const trimmed = uri.trim()
  if (!trimmed) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_JSON_TIMEOUT_MS)
  try {
    const res = await fetch(trimmed, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain;q=0.9,*/*;q=0.8' },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { name?: string }
    const n = normalizeWalletNftDisplayName(json?.name)
    return n || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveMetaplexNftTitleCandidates(
  connection: Connection,
  mintTrim: string
): Promise<string[]> {
  const candidates: string[] = []
  try {
    const meta = await getMetaplexTokenMetadata(connection, new PublicKey(mintTrim))
    if (meta?.name) {
      pushUniqueTitleCandidate(
        candidates,
        nftPrizeRaffleTitleFromWalletSelection(meta.name, mintTrim)
      )
    }
    if (meta?.uri) {
      const jsonName = await fetchMetadataJsonName(meta.uri)
      if (jsonName) {
        pushUniqueTitleCandidate(
          candidates,
          nftPrizeRaffleTitleFromWalletSelection(jsonName, mintTrim)
        )
      }
    }
  } catch {
    // Fall through.
  }
  return candidates
}

/**
 * All display titles accepted for an NFT mint.
 * Helius DAS first (matches /api/wallet/nfts), then Metaplex on-chain + JSON, then mint.
 */
export async function resolveNftPrizeRaffleTitleCandidatesFromMint(
  connection: Connection,
  mintAddress: string
): Promise<string[]> {
  const mintTrim = mintAddress.trim()
  const candidates: string[] = []

  const heliusMeta = await fetchNftMintMetaFromHelius(mintTrim)
  if (heliusMeta?.name) {
    pushUniqueTitleCandidate(
      candidates,
      nftPrizeRaffleTitleFromWalletSelection(heliusMeta.name, mintTrim)
    )
  }

  for (const title of await resolveMetaplexNftTitleCandidates(connection, mintTrim)) {
    pushUniqueTitleCandidate(candidates, title)
  }

  pushUniqueTitleCandidate(candidates, nftPrizeRaffleTitleFromWalletSelection(null, mintTrim))

  return candidates
}

/** Primary display title — prefers Helius DAS (wallet picker), then Metaplex, then mint. */
export async function resolveNftPrizeRaffleTitleFromMint(
  connection: Connection,
  mintAddress: string
): Promise<string> {
  const candidates = await resolveNftPrizeRaffleTitleCandidatesFromMint(connection, mintAddress)
  return (
    candidates[0] ?? nftPrizeRaffleTitleFromWalletSelection(null, mintAddress.trim())
  )
}

export function nftPrizeRaffleTitleMatchesSubmitted(
  submittedTitle: string,
  expectedTitle: string
): boolean {
  return (
    normalizeWalletNftDisplayName(submittedTitle) === normalizeWalletNftDisplayName(expectedTitle)
  )
}

export function nftPrizeRaffleTitleMatchesAnyCandidate(
  submittedTitle: string,
  candidateTitles: readonly string[]
): boolean {
  const submitted = normalizeWalletNftDisplayName(submittedTitle)
  if (!submitted) return false
  return candidateTitles.some(
    (candidate) => normalizeWalletNftDisplayName(candidate) === submitted
  )
}
