/** Automatic shelf pauses from inventory checks — not admin-set reasons. */
export function isAutomaticShelfPauseReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  if (reason.startsWith('Low NFT inventory')) return true
  if (reason.startsWith('NFT inventory empty during open')) return true
  return false
}

export function shouldClearAutomaticShelfPause(params: {
  shelfPaused: boolean
  shelfPauseReason: string | null | undefined
  nftCount: number
  minNft: number
}): boolean {
  if (!params.shelfPaused) return false
  if (!isAutomaticShelfPauseReason(params.shelfPauseReason)) return false
  return params.nftCount >= params.minNft
}
