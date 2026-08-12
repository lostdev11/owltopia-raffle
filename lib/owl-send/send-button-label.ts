import { OWL_SEND_MAX_SPECIAL_PER_TX } from '@/lib/owl-send/constants'

/**
 * Primary Confirm-send button label for NFT approval chains.
 * Multi-approval plans auto-chain after one click (wallet still confirms each tx).
 */
export function owlSendNftSendButtonLabel(params: {
  batchesTotal: number
  activeIndex: number
  status: string | undefined
  sendPhase?: string | null
  remainingFromActive?: number
}): string {
  const total = Math.max(1, params.batchesTotal)
  const index = Math.max(0, params.activeIndex)
  const remaining =
    params.remainingFromActive ??
    Math.max(1, total - index)
  const status = params.status ?? 'ready'

  if (status === 'sending') {
    const n = `${index + 1} of ${total}`
    if (params.sendPhase === 'confirming') return `Confirming ${n}…`
    if (params.sendPhase === 'approving') return `Approve in wallet (${n})…`
    return `Sending ${n}…`
  }

  if (status === 'failed') {
    return `Retry ${index + 1} of ${total}`
  }

  if (total === 1) return 'Are you sure? Send'

  // One click starts/continues the auto-chain for all remaining approvals.
  if (remaining > 1) {
    return index === 0
      ? `Send all ${remaining} approvals`
      : `Send remaining ${remaining} approvals`
  }

  return `Are you sure? Send ${index + 1} of ${total}`
}

/** True when this plan uses 1-asset special approvals (cNFT / pNFT). */
export function owlSendIsSpecialApprovalPlan(perApprovalSize: number): boolean {
  return perApprovalSize <= OWL_SEND_MAX_SPECIAL_PER_TX
}
