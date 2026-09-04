export type OwlwlCustomAction = 'submit' | 'confirm' | 'modal' | 'wallet'

export function parseOwlwlCustomId(
  customId: string | undefined
): { action: OwlwlCustomAction; campaignId: number } | null {
  const m = /^owlwl:(submit|confirm|modal|wallet):(\d+)$/.exec((customId ?? '').trim())
  if (!m) return null
  return {
    action: m[1] as OwlwlCustomAction,
    campaignId: Number(m[2]),
  }
}

export function wlComponentNeedsImmediateResponse(customId: string | undefined): boolean {
  const parsed = parseOwlwlCustomId(customId)
  return parsed?.action === 'submit' || parsed?.action === 'modal'
}
