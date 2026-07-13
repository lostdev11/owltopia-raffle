/** Partner-friendly labels for internal launch statuses (creator portal, not admin consoles). */

export type FriendlyLaunchStatus = {
  label: string
  /** Short "what happens next" hint for the creator. */
  hint: string | null
  tone: 'pending' | 'live' | 'done' | 'neutral'
}

export function friendlyLaunchStatus(status: string, activePhase?: string | null): FriendlyLaunchStatus {
  switch ((status || '').toUpperCase()) {
    case 'DRAFT':
      return { label: 'Draft', hint: 'Not submitted yet.', tone: 'neutral' }
    case 'PENDING_REVIEW':
      return {
        label: 'In review',
        hint: 'The Owltopia team is reviewing your collection — your mint page goes live here once approved.',
        tone: 'pending',
      }
    case 'PRESALE':
      return { label: 'Live — presale', hint: null, tone: 'live' }
    case 'WHITELIST':
      return { label: 'Live — whitelist mint', hint: null, tone: 'live' }
    case 'PUBLIC':
      return { label: 'Live — public mint', hint: null, tone: 'live' }
    case 'SOLD_OUT':
      return {
        label: 'Sold out',
        hint: 'Congrats! Marketplace listing tools are unlocked below.',
        tone: 'done',
      }
    case 'TRADING_ACTIVE':
      return { label: 'Trading live', hint: null, tone: 'done' }
    default: {
      const phase = (activePhase || '').trim()
      return { label: status || 'Unknown', hint: phase ? `Phase: ${phase}` : null, tone: 'neutral' }
    }
  }
}
