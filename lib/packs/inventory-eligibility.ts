import {
  isProgrammableNftInterface,
  isWalletNftTransferLocked,
} from '@/lib/solana/nft-transfer-lock'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

/** Why this NFT cannot go into packs inventory. Core and cNFT are allowed; pNFT is not. */
export function packsNftBlockReason(
  nft: Pick<WalletNft, 'interface' | 'compressed' | 'frozen' | 'delegated'>
): string | null {
  if (isProgrammableNftInterface(nft.interface)) return 'pNFT — vault cannot pay these out yet'
  if (isWalletNftTransferLocked(nft)) return 'Frozen / nested / locked'
  return null
}

export function isPacksInventoryEligible(nft: WalletNft): boolean {
  return packsNftBlockReason(nft) == null
}
