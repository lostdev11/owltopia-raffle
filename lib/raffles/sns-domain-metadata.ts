import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Bonfida name-tokenizer verified collection for wrapped/tokenized `.sol` domains (mainnet).
 * @see https://github.com/Bonfida/name-tokenizer — NFTs are all part of this verified collection.
 */
export const SNS_TOKENIZED_DOMAINS_COLLECTION_MAINNET =
  'E5ZnBpH9DYcxRkumKdS4ayJ3Ftb6o3E8wSbXw4N92GWg' as const

const SNS_DOMAIN_COLLECTION_MINTS = new Set<string>([SNS_TOKENIZED_DOMAINS_COLLECTION_MAINNET])

/** Metaplex metadata names are fixed-width; strip NULs before matching. */
export function normalizeWalletNftDisplayName(name: string | null | undefined): string {
  return (name ?? '').replace(/\0/g, '').trim()
}

/** Name/symbol from Metaplex metadata account + optional off-chain collection label (wallet list). */
export function onchainMetadataLooksLikeSnsDomain(
  name: string,
  symbol: string,
  collectionName?: string | null
): boolean {
  const n = normalizeWalletNftDisplayName(name)
  const sym = normalizeWalletNftDisplayName(symbol)
  const col = normalizeWalletNftDisplayName(collectionName)
  if (/\.sol$/i.test(n)) return true
  if (/sns|solana name service|bonfida/i.test(col)) return true
  if (/^sns$/i.test(sym) || /solana name service|bonfida/i.test(sym)) return true
  return false
}

/**
 * JSON/metadata URI hints for SNS domain NFTs. Helius/DAS often exposes a short `name` without `.sol`
 * while `json_uri` still points at SNS/Bonfida-hosted metadata.
 */
export function metadataUriLooksLikeSnsDomain(uri: string | null | undefined): boolean {
  const u = (uri ?? '').trim().toLowerCase()
  if (!u) return false
  return (
    u.includes('bonfida') ||
    u.includes('sns.') ||
    u.includes('sns.id') ||
    u.includes('solana-name-service') ||
    u.includes('name-official') ||
    u.includes('/sns/') ||
    u.includes('sns-')
  )
}

/**
 * Heuristic for wallet-picker lists: Metaplex padding, verified SNS tokenizer collection, URI hints,
 * name/collection/symbol. Server still re-checks on-chain metadata on create.
 */
export function walletNftLooksLikeSnsDomain(
  nft: Pick<WalletNft, 'name' | 'collectionName' | 'metadataUri'> & {
    collectionMint?: string | null
    symbol?: string | null
  }
): boolean {
  const cm = (nft.collectionMint ?? '').trim()
  if (cm && SNS_DOMAIN_COLLECTION_MINTS.has(cm)) return true
  if (metadataUriLooksLikeSnsDomain(nft.metadataUri)) return true
  return onchainMetadataLooksLikeSnsDomain(
    nft.name ?? '',
    nft.symbol ?? '',
    nft.collectionName ?? null
  )
}
