import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Picker badge for non-transferable locks.
 *
 * Important: many Gen2 (and CM-freeze) NFTs keep a leftover **delegate** after thaw and are
 * still sendable. Only treat **frozen** token accounts as nested/staked locks for UI.
 */
export function owlSendNftLockLabel(nft: WalletNft): string | null {
  if (nft.frozen === true) return 'Frozen/nested'
  return null
}
