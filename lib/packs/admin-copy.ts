const LOW_NFT_INVENTORY_RE = /^Low NFT inventory \((\d+) < min (\d+)\)$/

/** Plain-language pause reason for admin and player UI. */
export function packPauseReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (reason === 'Fund vault and unpause when inventory is ready') {
    return 'Add funds and prize NFTs, then turn packs on when you’re ready'
  }
  if (reason === 'Vault config missing — apply migration 212') {
    return 'Vault isn’t set up yet'
  }
  if (reason === 'NFT inventory empty during open — paused') {
    return 'No prize NFTs left — packs were paused automatically'
  }
  if (reason === 'Packs not configured yet') {
    return 'Packs aren’t set up yet'
  }
  const low = reason.match(LOW_NFT_INVENTORY_RE)
  if (low) {
    return `Not enough prize NFTs (${low[1]}, need at least ${low[2]})`
  }
  return reason
}

export function packRtpPercentLabel(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`
}
