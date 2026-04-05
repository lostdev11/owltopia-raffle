/**
 * Status filters for the public raffles list (/, /raffles) and matching API.
 * Keep in sync with PostgREST `status=in.(...)` and Supabase `.in('status', ...)`.
 */
export const RAFFLES_PUBLIC_LIST_STATUSES = [
  'live',
  'ready_to_draw',
  'completed',
  'successful_pending_claims',
  'failed_refund_available',
] as const

/** Drafts + full terminal set (same as ALL_STATUSES in lib/db/raffles.ts). */
export const RAFFLES_PUBLIC_LIST_STATUSES_WITH_DRAFT = [
  'draft',
  'live',
  'ready_to_draw',
  'completed',
  'cancelled',
  'pending_min_not_met',
  'successful_pending_claims',
  'failed_refund_available',
] as const

export const RAFFLES_ACTIVE_ONLY_LIST_STATUSES = ['live', 'ready_to_draw'] as const

export function rafflesRestStatusInClause(includeDraft: boolean, activeOnly: boolean): string {
  if (activeOnly) {
    return `in.(${[...RAFFLES_ACTIVE_ONLY_LIST_STATUSES].join(',')})`
  }
  const statuses = includeDraft ? RAFFLES_PUBLIC_LIST_STATUSES_WITH_DRAFT : RAFFLES_PUBLIC_LIST_STATUSES
  return `in.(${[...statuses].join(',')})`
}
