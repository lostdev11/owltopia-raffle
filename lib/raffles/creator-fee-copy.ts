import { HOLDER_FEE_BPS, PARTNER_COMMUNITY_FEE_BPS, STANDARD_FEE_BPS } from '@/lib/config/raffles'

export type PlatformFeeReason = 'holder' | 'standard' | 'partner_community'

export function feeBpsToDisplayPercent(bps: number): number {
  return bps / 100
}

const HOLDER_PCT = feeBpsToDisplayPercent(HOLDER_FEE_BPS)
const STANDARD_PCT = feeBpsToDisplayPercent(STANDARD_FEE_BPS)
const PARTNER_PCT = feeBpsToDisplayPercent(PARTNER_COMMUNITY_FEE_BPS)

function reasonLabel(reason: PlatformFeeReason): string {
  switch (reason) {
    case 'partner_community':
      return 'verified partner'
    case 'holder':
      return 'Owltopia NFT holder'
    default:
      return 'standard creator'
  }
}

/** Plain-language fee blurb for the create-raffle form. */
export function buildCreateRaffleFeeCopy(opts: {
  connected: boolean
  /** False while /api/raffles/visibility-options fee tier is in flight. */
  feeTierLoaded?: boolean
  feeBps?: number
  feeReason?: PlatformFeeReason
}): { heading: string; lines: string[]; yourRate: string | null } {
  const baseLines = [
    'Free to create a raffle. On each confirmed ticket sale, a small platform fee is taken from that payment — you receive the rest.',
    'Ticket money is held in escrow until after the draw; you claim your share from your dashboard when it is ready.',
  ]

  if (!opts.connected) {
    return {
      heading: 'Platform fees',
      lines: [
        ...baseLines,
        `Rates: ${PARTNER_PCT}% for verified partners, ${HOLDER_PCT}% for Owltopia NFT holders, or ${STANDARD_PCT}% otherwise. Connect your wallet to see your rate.`,
      ],
      yourRate: null,
    }
  }

  if (opts.feeTierLoaded === false) {
    return {
      heading: 'Platform fees',
      lines: [...baseLines, 'Checking your rate…'],
      yourRate: null,
    }
  }

  if (opts.feeBps == null || opts.feeReason == null) {
    return {
      heading: 'Platform fees',
      lines: [
        ...baseLines,
        'We could not load your rate. Refresh the page or sign in with your wallet (Dashboard → Sign in) and try again.',
      ],
      yourRate: null,
    }
  }

  const pct = feeBpsToDisplayPercent(opts.feeBps)

  return {
    heading: 'Platform fees',
    lines: baseLines,
    yourRate: `Your rate: ${pct}% (${reasonLabel(opts.feeReason)})`,
  }
}
