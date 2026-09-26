import { getPackOpenByPaymentSignature, updatePackOpen } from '@/lib/packs/db'
import {
  payoutCommittedPackOpen,
  recordManualPackOpenResolution,
} from '@/lib/packs/open-payout'
import type { PackOpenResult } from '@/lib/packs/types'

export type AdminResolvePackOpenInput =
  | {
      paymentSignature: string
      action: 'payout'
    }
  | {
      paymentSignature: string
      action: 'record_manual'
      payoutSignature: string
      resolution: 'prize_paid' | 'refund'
    }

/**
 * Admin-only: finish a stuck open without re-rolling the committed prize.
 */
export async function adminResolvePackOpenByPaymentSignature(
  input: AdminResolvePackOpenInput
): Promise<PackOpenResult> {
  const sig = input.paymentSignature.trim()
  if (!sig) throw new Error('paymentSignature is required')

  const open = await getPackOpenByPaymentSignature(sig)
  if (!open) throw new Error('No pack open found for that payment signature')

  if (open.status === 'completed') {
    throw new Error('Pack open is already completed')
  }

  if (input.action === 'record_manual') {
    if (!open.open_seed || !open.category) {
      throw new Error('Cannot record manual resolution before a prize is committed')
    }
    return recordManualPackOpenResolution({
      open,
      payoutSignature: input.payoutSignature,
      resolution: input.resolution,
    })
  }

  if (!open.open_seed || !open.open_commit_hash || !open.category) {
    throw new Error(
      'Open has no committed prize yet — use normal open flow or fix payment state first'
    )
  }

  if (open.status === 'refund_needed') {
    await updatePackOpen(open.id, {
      status: 'paying_out',
      error_message: null,
    })
  }

  return payoutCommittedPackOpen({
    open: { ...open, status: 'paying_out' },
    buyerWallet: open.buyer_wallet,
  })
}
