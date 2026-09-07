/**
 * OwlSwap Trading Room — pure UI state helpers (no timers as settlement proof).
 */

export type OwlSwapTxUiState =
  | 'idle_review'
  | 'awaiting_signature'
  | 'submitting'
  | 'pending_confirmation'
  | 'open_shared'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type OwlSwapOfferStatus =
  | 'draft'
  | 'open'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | string

export type TradingRoomAsset = {
  mint: string
  name?: string | null
  imageUrl?: string | null
  collection?: string | null
}

export function isTerminalTxUiState(state: OwlSwapTxUiState): boolean {
  return (
    state === 'completed' ||
    state === 'rejected' ||
    state === 'failed' ||
    state === 'cancelled' ||
    state === 'expired' ||
    state === 'open_shared'
  )
}

export function isInFlightTxUiState(state: OwlSwapTxUiState): boolean {
  return (
    state === 'awaiting_signature' ||
    state === 'submitting' ||
    state === 'pending_confirmation'
  )
}

/** Completed visuals only when server says completed AND settle sig exists. */
export function canShowCompletedTradeVisuals(params: {
  offerStatus: OwlSwapOfferStatus | null | undefined
  settleSig: string | null | undefined
}): boolean {
  return params.offerStatus === 'completed' && Boolean(params.settleSig)
}

/**
 * Map offer + local flow evidence → Trading Room banner state.
 * Decorative animations must never force `completed`.
 */
export function deriveTradingRoomTxUiState(params: {
  offerStatus?: OwlSwapOfferStatus | null
  settleSig?: string | null
  makerDepositSig?: string | null
  /** Local client phase while creating or accepting. */
  localPhase?:
    | 'idle'
    | 'awaiting_signature'
    | 'submitting'
    | 'pending_confirmation'
    | 'rejected'
    | 'failed'
    | null
  /** Maker create flow after open: show share, not completed. */
  mode?: 'create' | 'accept'
}): OwlSwapTxUiState {
  const status = params.offerStatus ?? null
  const local = params.localPhase ?? 'idle'
  const mode = params.mode ?? 'accept'

  if (status === 'cancelled') return 'cancelled'
  if (status === 'expired') return 'expired'

  if (canShowCompletedTradeVisuals({ offerStatus: status, settleSig: params.settleSig })) {
    return 'completed'
  }

  // Never treat completed-without-sig as success.
  if (status === 'completed' && !params.settleSig) {
    return local === 'failed' ? 'failed' : 'pending_confirmation'
  }

  if (local === 'rejected') return 'rejected'
  if (local === 'failed') return 'failed'
  if (local === 'awaiting_signature') return 'awaiting_signature'
  if (local === 'submitting') return 'submitting'
  if (local === 'pending_confirmation') return 'pending_confirmation'

  if (mode === 'create' && status === 'open' && params.makerDepositSig) {
    return 'open_shared'
  }

  return 'idle_review'
}

export function tradingRoomStatusBannerCopy(state: OwlSwapTxUiState): {
  tone: 'neutral' | 'progress' | 'success' | 'error' | 'warn'
  title: string
  detail?: string
} {
  switch (state) {
    case 'idle_review':
      return {
        tone: 'neutral',
        title: 'Review both sides and fees before signing.',
      }
    case 'awaiting_signature':
      return {
        tone: 'progress',
        title: 'Approve in your wallet…',
        detail: 'Do not close this tab until the wallet returns.',
      }
    case 'submitting':
      return {
        tone: 'progress',
        title: 'Submitting…',
      }
    case 'pending_confirmation':
      return {
        tone: 'progress',
        title: 'Confirming on-chain…',
        detail: 'This is not complete until the network confirms.',
      }
    case 'open_shared':
      return {
        tone: 'success',
        title: 'Offer is open — share your link',
        detail: 'Assets are in escrow (or simulated). Waiting for a counterparty.',
      }
    case 'completed':
      return {
        tone: 'success',
        title: 'Swap completed',
        detail: 'Settlement signature recorded.',
      }
    case 'rejected':
      return {
        tone: 'warn',
        title: 'Wallet rejected the request',
        detail: 'Chambers unchanged — try again when ready.',
      }
    case 'failed':
      return {
        tone: 'error',
        title: 'Something failed',
        detail: 'No completed-trade state. Fix the error and retry.',
      }
    case 'cancelled':
      return { tone: 'warn', title: 'Offer cancelled' }
    case 'expired':
      return { tone: 'warn', title: 'Offer expired' }
    default:
      return { tone: 'neutral', title: 'Review trade' }
  }
}

/** Bump when selection / offer assets change so prior review approval is cleared. */
export function nextReviewEpoch(current: number): number {
  return current + 1
}

export function selectionFingerprint(assets: TradingRoomAsset[], solLamports = 0): string {
  const mints = assets
    .map((a) => a.mint)
    .filter(Boolean)
    .sort()
    .join(',')
  return `${mints}|${solLamports}`
}

export function formatNftCountBadge(count: number): string {
  if (count <= 0) return '0 NFT'
  return count === 1 ? '1 NFT' : `${count} NFTs`
}

export function formatTradeSummaryLine(params: {
  offerCount: number
  receiveCount: number
  offerSolLamports?: number
  receiveSolLamports?: number
}): string {
  const offer = formatNftCountBadge(params.offerCount)
  const receive =
    params.receiveCount > 0 ? formatNftCountBadge(params.receiveCount) : 'counterparty'
  const parts = [`${offer} for ${receive}`]
  const offerSol = params.offerSolLamports ?? 0
  const receiveSol = params.receiveSolLamports ?? 0
  if (offerSol > 0 || receiveSol > 0) {
    parts.push('(+ SOL)')
  }
  return parts.join(' ')
}

export function shouldEnablePrimaryCta(params: {
  txState: OwlSwapTxUiState
  offerSideReady: boolean
  receiveSideOptional?: boolean
  receiveSideReady?: boolean
  escrowReady: boolean
  feeQuoteReady: boolean
}): boolean {
  if (isInFlightTxUiState(params.txState)) return false
  if (params.txState === 'completed' || params.txState === 'cancelled' || params.txState === 'expired') {
    return false
  }
  if (params.txState === 'open_shared') return false
  if (!params.offerSideReady) return false
  if (!params.escrowReady) return false
  if (!params.feeQuoteReady) return false
  if (params.receiveSideOptional === false && !params.receiveSideReady) return false
  return true
}
