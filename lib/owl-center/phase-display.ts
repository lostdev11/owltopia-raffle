import type { OwlCenterPhase } from '@/lib/owl-center/types'

/** User-facing phase labels (gembird / Owltopia copy). */
export const OWL_CENTER_PHASE_LABELS: Record<OwlCenterPhase, string> = {
  AIRDROP: 'GEN1',
  PRESALE: 'Presale',
  PRESALE_OVERAGE: 'Presale+13',
  WHITELIST: 'WL',
  PUBLIC: 'Public',
  SOLD_OUT: 'Sold out',
  TRADING_ACTIVE: 'Trading',
}

export function owlCenterPhaseLabel(phase: OwlCenterPhase): string {
  return OWL_CENTER_PHASE_LABELS[phase] ?? phase
}

/**
 * Short tag beside an active phase row (mint checker, etc.).
 * Presale purchase supply exhausted → "SOLD OUT" even while PRESALE mint redemption is open.
 */
export function owlCenterActivePhaseTag(
  phase: OwlCenterPhase,
  opts?: { presaleSoldOut?: boolean }
): 'LIVE' | 'SOLD OUT' {
  if (phase === 'PRESALE' && opts?.presaleSoldOut) return 'SOLD OUT'
  return 'LIVE'
}

/** Mint console header — clarifies presale purchase sellout vs mint phase queue. */
export function owlCenterMintPhaseStatusLabel(
  phase: OwlCenterPhase,
  opts?: { presaleSoldOut?: boolean }
): string {
  if (phase === 'AIRDROP') return 'GEN1'
  if (phase === 'PRESALE' && opts?.presaleSoldOut) {
    return 'Presale redemption (presale purchases sold out)'
  }
  return owlCenterPhaseLabel(phase)
}

type MintWrongPhaseHintInput = {
  activePhase: OwlCenterPhase
  presaleSoldOut: boolean
  isGen1Holder: boolean
}

/**
 * Shown when the user cannot mint in the launch's current active phase (e.g. GEN1 holder while queue is on Presale).
 */
export function owlCenterMintWrongPhaseHint(input: MintWrongPhaseHintInput): string | null {
  const { activePhase, presaleSoldOut, isGen1Holder } = input
  if (activePhase === 'AIRDROP' || activePhase === 'SOLD_OUT' || activePhase === 'TRADING_ACTIVE') {
    return null
  }

  if (activePhase === 'PRESALE' && presaleSoldOut) {
    if (isGen1Holder) {
      return 'Presale purchases are sold out — that is not an open presale sale. GEN1 mint opens when admin activates the GEN1 phase. Your reserved GEN1 spots are in Allocation above.'
    }
    return 'Presale purchases are sold out. Paid presale credits redeem after the GEN1 phase completes — see Allocation above for your reserved spots.'
  }

  const queueLabel = owlCenterPhaseLabel(activePhase)
  if (isGen1Holder) {
    return `The launch queue is on ${queueLabel} right now. GEN1 holders mint when admin opens the GEN1 phase — see Allocation above for your reserved count.`
  }
  return `Minting for ${queueLabel} is not available for this wallet yet. See Allocation above for your reserved spots.`
}

/** FCFS collab channels from Discord (for admin reference + WL tagging). */
export const GEN2_WL_COLLAB_COMMUNITIES = [
  { slug: 'gen2-wl', label: 'Discord GEN2 WL (Atlas3)' },
  { slug: 'pandarianz', label: 'Pandarianz' },
  { slug: 'sharkyfi', label: 'SharkyFi' },
  { slug: 'luckysea', label: 'Lucky Sea' },
  { slug: 'basc', label: 'BASC' },
  { slug: 'shonensol', label: 'Shonen SOL' },
  { slug: 'fuddy-dogs', label: 'Fuddy Dogs' },
  { slug: 'necors', label: 'Necors' },
  { slug: 'frens-factory', label: 'Frens Factory' },
] as const
