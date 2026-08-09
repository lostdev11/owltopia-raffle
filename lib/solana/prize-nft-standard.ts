/**
 * Map wallet/DAS NFT hints to raffle prize_standard and escrow transfer ordering.
 */
import type { PrizeStandard } from '@/lib/types'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

function normIface(iface: string | null | undefined): string {
  return (iface ?? '').trim().toLowerCase()
}

/** True when DAS interface is Metaplex Core (asset or collection). */
export function isDasMplCoreInterface(iface: string | null | undefined): boolean {
  const v = normIface(iface)
  return v === 'mplcoreasset' || v === 'mplcorecollection' || v === 'mplcoreassetv1' || v.includes('mplcore')
}

/** True when DAS / wallet row indicates a compressed (Bubblegum) NFT. */
export function isDasCompressedNft(params: {
  interface?: string | null
  compressed?: boolean | null
}): boolean {
  if (params.compressed === true) return true
  const v = normIface(params.interface)
  return v === 'v1_nft_compressed' || v.includes('compressed')
}

/**
 * Classic Token Metadata / pNFT / Token-2022 NFT interfaces that use mint + token accounts
 * (not Core asset accounts, not Bubblegum leaves).
 */
export function isDasTokenMetadataInterface(iface: string | null | undefined): boolean {
  const v = normIface(iface)
  if (!v) return false
  if (isDasMplCoreInterface(v) || isDasCompressedNft({ interface: v })) return false
  return (
    v === 'v1_nft' ||
    v === 'v2_nft' ||
    v === 'v1_print' ||
    v === 'legacy' ||
    v === 'custom' ||
    v === 'programmablenft' ||
    v.includes('programmable') ||
    v.includes('nft')
  )
}

/**
 * Infer raffle `prize_standard` from a wallet/DAS NFT row.
 * Returns null when unknown (legacy create paths leave DB null → treat as SPL).
 */
export function prizeStandardFromWalletNft(
  nft: Pick<WalletNft, 'interface' | 'compressed'>
): PrizeStandard | null {
  if (isDasCompressedNft(nft)) return 'compressed'
  if (isDasMplCoreInterface(nft.interface)) return 'mpl_core'
  if (isDasTokenMetadataInterface(nft.interface)) return 'spl'
  return null
}

export type EscrowFallbackKind = 'token_metadata' | 'compressed' | 'mpl_core'

/**
 * Order of non-SPL escrow transfer attempts when the wallet RPC did not resolve a token account.
 * Prefer Token Metadata for classic/pNFTs — Core fetchAsset on an SPL mint surfaces SDK
 * AssetAccountData / EnumDiscriminatorOutOfRangeError noise (e.g. discriminator 129).
 */
export function orderedEscrowFallbacks(params: {
  interface?: string | null
  compressed?: boolean | null
  /** When true, skip Token Metadata (already attempted via SPL holder path). */
  skipTokenMetadata?: boolean
}): EscrowFallbackKind[] {
  const kinds: EscrowFallbackKind[] = []
  const push = (k: EscrowFallbackKind) => {
    if (!kinds.includes(k)) kinds.push(k)
  }

  if (isDasCompressedNft(params)) {
    push('compressed')
    if (!params.skipTokenMetadata) push('token_metadata')
    push('mpl_core')
    return kinds
  }
  if (isDasMplCoreInterface(params.interface)) {
    push('mpl_core')
    push('compressed')
    if (!params.skipTokenMetadata) push('token_metadata')
    return kinds
  }

  // Default / Token Metadata / unknown: TM first, then compressed, then Core.
  if (!params.skipTokenMetadata) push('token_metadata')
  push('compressed')
  push('mpl_core')
  return kinds
}
