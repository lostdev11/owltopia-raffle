import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Whether an NFT should appear in the OwlSend picker.
 *
 * Hide staked/nested holdings (`delegated`). Do **not** hide on `frozen` alone —
 * Gen2 mint-out freeze and similar DAS flags would wipe most of a collection from
 * the picker even when the NFT is still owned and (after thaw) sendable.
 * Send-time preflight still blocks truly non-transferable accounts.
 */
export function isOwlSendPickerEligible(nft: WalletNft): boolean {
  if (nft.delegated === true) return false
  return true
}

export function filterOwlSendPickerNfts(nfts: WalletNft[]): {
  eligible: WalletNft[]
  hiddenCount: number
} {
  const eligible = nfts.filter(isOwlSendPickerEligible)
  return { eligible, hiddenCount: Math.max(0, nfts.length - eligible.length) }
}
