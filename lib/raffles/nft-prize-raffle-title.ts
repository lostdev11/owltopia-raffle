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

export type ResolveNftPrizeRaffleTitleOptions = {
  /** Client-provided metadata JSON URI (e.g. from wallet picker) when on-chain/Helius name lookup fails. */
  metadataUriHint?: string | null
}

/**
 * All display titles accepted for an NFT mint.
 * Helius DAS first (matches /api/wallet/nfts), then Metaplex on-chain + JSON,
 * then optional metadata URI hint, then mint.
 */
export async function resolveNftPrizeRaffleTitleCandidatesFromMint(
  connection: Connection,
  mintAddress: string,
  options?: ResolveNftPrizeRaffleTitleOptions
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

  const uriHint = options?.metadataUriHint?.trim()
  if (uriHint) {
    const jsonName = await fetchMetadataJsonName(uriHint)
    if (jsonName) {
      pushUniqueTitleCandidate(
        candidates,
        nftPrizeRaffleTitleFromWalletSelection(jsonName, mintTrim)
      )
    }
  }

  pushUniqueTitleCandidate(candidates, nftPrizeRaffleTitleFromWalletSelection(null, mintTrim))

  return candidates
}

/** Primary display title — prefers Helius DAS (wallet picker), then Metaplex, then URI hint, then mint. */
export async function resolveNftPrizeRaffleTitleFromMint(
  connection: Connection,
  mintAddress: string,
  options?: ResolveNftPrizeRaffleTitleOptions
): Promise<string> {
  const candidates = await resolveNftPrizeRaffleTitleCandidatesFromMint(
    connection,
    mintAddress,
    options
  )
  return (
    candidates[0] ?? nftPrizeRaffleTitleFromWalletSelection(null, mintAddress.trim())
  )
}

/** True when the stored raffle title is just the prize mint (metadata name never resolved). */
export function raffleStoredTitleLooksLikeMint(
  title: string,
  nftMintAddress: string | null | undefined
): boolean {
  const t = normalizeWalletNftDisplayName(title)
  const mint = (nftMintAddress ?? '').trim()
  return !!t && !!mint && t.toLowerCase() === mint.toLowerCase()
}

/**
 * UI title for cards/detail when create-time metadata resolution fell back to the mint.
 * Prefers collection name, otherwise a shortened mint.
 */
export function getRaffleDisplayTitle(raffle: {
  title: string
  nft_mint_address?: string | null
  nft_collection_name?: string | null
}): string {
  if (!raffleStoredTitleLooksLikeMint(raffle.title, raffle.nft_mint_address)) {
    return raffle.title
  }
  const collection = normalizeWalletNftDisplayName(raffle.nft_collection_name)
  if (collection) return collection
  const mint = (raffle.nft_mint_address ?? raffle.title).trim()
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
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
