/**
 * Pure OwlSend helpers for leftover MPL Core Owner FreezeDelegate locks.
 * (RPC read lives in `mpl-core-owner-freeze-read.ts` so unit tests stay dep-light.)
 */

import { isMplCoreWrongAccountTypeError } from '@/lib/solana/mpl-core-transfer-errors'

/** Stable phrase so `isOwlSendFrozenTransferError` + thaw UI can match it. */
export const OWL_SEND_CORE_OWNER_FREEZE_ERROR =
  'This NFT is still frozen from a closed nest (Owner FreezeDelegate). Open Nesting → Thaw leftover nest locks, or tap Thaw locks here, then Retry.'

export function isOwlSendCoreOwnerFreezeError(message: string): boolean {
  const m = (message ?? '').toLowerCase()
  return (
    m.includes('owner freezedelegate') ||
    m.includes('thaw leftover nest locks') ||
    (m.includes('still frozen from a closed nest') && m.includes('thaw'))
  )
}

/** True when a Core transfer failure looks like a freeze / plugin block (not wrong account type). */
export function isOwlSendMplCoreFreezeTransferError(message: string): boolean {
  const m = (message ?? '').toLowerCase()
  if (isMplCoreWrongAccountTypeError(m)) return false
  return (
    m.includes('frozen') ||
    m.includes('freezedelegate') ||
    m.includes('freeze delegate') ||
    m.includes('0x11') ||
    m.includes('noapprovals') ||
    m.includes('0x1a') ||
    isOwlSendCoreOwnerFreezeError(m)
  )
}

/**
 * Prefer actionable freeze/nest errors over noisy Token Metadata / compressed fallbacks
 * (e.g. Incorrect account owner 0x39 after trying TM on a Core asset).
 */
export function pickOwlSendSpecialNftError(errors: string[]): string | null {
  if (errors.length < 1) return null
  const freeze = errors.find(
    (e) => isOwlSendCoreOwnerFreezeError(e) || isOwlSendMplCoreFreezeTransferError(e)
  )
  if (freeze) return freeze
  // Prefer the first attempt (DAS-ordered primary path) over last-fallback noise.
  return errors[0] ?? null
}
