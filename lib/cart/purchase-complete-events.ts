/** Dispatched after checkout confirms tickets so open screens refetch entries immediately. */

export const PURCHASE_COMPLETED_EVENT = 'owlraffle:purchase-completed'

export type PurchaseCompletedDetail = {
  wallet: string
  raffleIds: readonly string[]
}

export function dispatchPurchaseCompleted(detail: PurchaseCompletedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PURCHASE_COMPLETED_EVENT, { detail }))
}
