import { isWalletNftTransferLocked } from '@/lib/solana/nft-transfer-lock'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Why this NFT cannot go into packs inventory.
 * Classic SPL, Core, compressed, and pNFT are allowed; true nest/stake locks are not.
 */
export function packsNftBlockReason(
  nft: Pick<WalletNft, 'interface' | 'compressed' | 'frozen' | 'delegated'>
): string | null {
  if (isWalletNftTransferLocked(nft)) return 'Frozen / nested / locked'
  return null
}

export function isPacksInventoryEligible(nft: WalletNft): boolean {
  return packsNftBlockReason(nft) == null
}
