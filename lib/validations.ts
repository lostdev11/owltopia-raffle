import { z } from 'zod'

const solanaAddress = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/)

export const entriesCreateBody = z.object({
  raffleId: z.string().uuid(),
  walletAddress: solanaAddress,
  ticketQuantity: z.coerce.number().int().min(1).max(1000),
})

export const entriesVerifyBody = z.object({
  entryId: z.string().uuid(),
  transactionSignature: z.string().min(80).max(120),
})

export const claimRefundEntryBody = z.object({
  entryId: z.string().uuid(),
})

/** Full admin: after a manual treasury/escrow payout, mark ticket rows refunded so buyers see sent/claimed. */
export const recordManualRefundsBody = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(500),
  transactionSignature: z.string().trim().min(80).max(120),
})

/**
 * TEMPORARY — remove after one-time admin refunds from funds escrow are done.
 * Full admin: send payouts from FUNDS_ESCROW for failed_refund_available raffles (legacy or standard escrow).
 */
export const adminLegacyEscrowRefundBody = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(50),
})

export const rafflesPostBody = z.object({
  wallet_address: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  slug: z.string().max(100).optional(),
  ticket_price: z.number().positive(),
  currency: z.enum(['SOL', 'USDC', 'OWL']).optional(),
  end_time: z.string().min(1),
  start_time: z.string().optional(),
  status: z.enum(['draft', 'live', 'ready_to_draw', 'completed']).optional(),
  max_tickets: z.number().int().positive().optional().nullable(),
  min_tickets: z.number().int().positive().optional().nullable(),
  prize_type: z.enum(['crypto', 'nft']).optional(),
  prize_amount: z.number().optional(),
  prize_currency: z.string().optional(),
  nft_mint_address: z.string().optional().nullable(),
  nft_token_id: z.string().optional().nullable(),
  theme_accent: z.enum(['prime', 'midnight', 'dawn', 'ember', 'violet', 'coral']).optional(),
})

export const authVerifyBody = z.object({
  wallet: solanaAddress,
  message: z.string().min(1),
  signature: z.string().min(1),
})

export const profileUpdateBody = z.object({
  displayName: z.string().min(1).max(32).trim(),
})

export function parseOr400<T>(schema: z.ZodSchema<T>, data: unknown): { ok: true; data: T } | { ok: false; status: 400; error: string } {
  const result = schema.safeParse(data)
  if (result.success) return { ok: true, data: result.data }
  const first = result.error.flatten().fieldErrors
  const msg = Object.entries(first)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('; ') || result.error.message
  return { ok: false, status: 400, error: msg }
}
