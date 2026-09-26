import type { PackOpenStatus } from '@/lib/packs/types'

export const ADMIN_PACK_OPEN_STATUSES: PackOpenStatus[] = [
  'pending_payment',
  'paid',
  'rolling',
  'reserved',
  'paying_out',
  'completed',
  'failed',
  'refund_needed',
]

/** Terminal — excluded from “stuck in pipeline” unless refund_needed / failed presets. */
export const ADMIN_PACK_OPEN_TERMINAL_STATUSES: PackOpenStatus[] = ['completed', 'failed']

export const ADMIN_PACK_OPEN_STUCK_PIPELINE_STATUSES: PackOpenStatus[] = [
  'pending_payment',
  'paid',
  'rolling',
  'reserved',
  'paying_out',
]

/** Default age threshold for stuck pipeline rows. */
export const ADMIN_PACK_OPEN_STUCK_MINUTES_DEFAULT = 5

export const ADMIN_PACK_OPEN_STATUS_LABELS: Record<PackOpenStatus, string> = {
  pending_payment: 'Pending payment',
  paid: 'Paid',
  rolling: 'Rolling',
  reserved: 'Reserved',
  paying_out: 'Paying out',
  completed: 'Completed',
  failed: 'Failed',
  refund_needed: 'Refund needed',
}
