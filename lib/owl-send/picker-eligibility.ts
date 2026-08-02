import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Picker badge for non-transferable locks.
 *
 * Important: many Gen2 (and CM-freeze) NFTs keep a leftover **delegate** after thaw and are
 * still sendable. Only treat **frozen** token accounts as nested/staked locks for UI.
 */
export function owlSendNftLockLabel(nft: WalletNft): string | null {
  if (nft.frozen === true) return 'Frozen (nest/mint lock)'
  return null
}

/** Badge when this mint failed a send/preflight (highlighted in the picker). */
export function owlSendNftProblemLabel(
  nft: WalletNft,
  problemMints: Set<string> | undefined
): string | null {
  if (problemMints?.has(nft.mint)) {
    return nft.frozen === true ? 'Can’t send · frozen' : 'Can’t send · see retry'
  }
  return owlSendNftLockLabel(nft)
}
