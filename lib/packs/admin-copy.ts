const LOW_NFT_INVENTORY_RE = /^Low NFT inventory \((\d+) < min (\d+)\)$/

const LAUNCH_PAUSE_REASONS = new Set([
  'Fund vault and unpause when inventory is ready',
  'Vault isn’t set up yet',
  'Vault config missing — apply migration 212',
  'Packs not configured yet',
])

/** True when packs have never been turned on (vs an operational pause). */
export function isPacksLaunchPause(reason: string | null | undefined): boolean {
  if (reason === undefined) return true
  if (!reason) return false
  return LAUNCH_PAUSE_REASONS.has(reason)
}

/** Player-facing pause copy. Launch pause stays “coming soon”; ops pauses stay specific. */
export function packPublicPauseMessage(reason: string | null | undefined): string {
  if (isPacksLaunchPause(reason)) {
    return 'Owl Packs aren’t open for purchase yet. Check back soon.'
  }
  const labeled = packPauseReasonLabel(reason)
  return labeled ? `Temporarily paused: ${labeled}` : 'Temporarily paused'
}

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
  if (reason === 'Paused by admin') {
    return 'Turned off by admin'
  }
  if (reason === 'Vault isn’t set up yet') {
    return 'Vault isn’t set up yet'
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
