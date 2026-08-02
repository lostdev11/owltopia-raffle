import type { WalletNft } from '@/lib/solana/wallet-tokens'

/** Short lock status for picker badges (does not hide the NFT). */
export function owlSendNftLockLabel(nft: WalletNft): string | null {
  if (nft.delegated === true) return 'Staked/nested'
  if (nft.frozen === true) return 'Frozen'
  return null
}
