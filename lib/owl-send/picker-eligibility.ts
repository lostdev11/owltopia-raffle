import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Whether an NFT should appear in the OwlSend picker.
 * Hides staked/nested (delegated) and freeze-locked assets.
 * Programmable NFTs stay visible — they are frozen by design but sendable via Token Metadata.
 */
export function isOwlSendPickerEligible(nft: WalletNft): boolean {
  if (nft.delegated === true) return false
  if (nft.frozen === true) {
    const iface = (nft.interface ?? '').toLowerCase()
    if (iface.includes('programmable')) return true
    return false
  }
  return true
}

export function filterOwlSendPickerNfts(nfts: WalletNft[]): {
  eligible: WalletNft[]
  hiddenCount: number
} {
  const eligible = nfts.filter(isOwlSendPickerEligible)
  return { eligible, hiddenCount: Math.max(0, nfts.length - eligible.length) }
}
