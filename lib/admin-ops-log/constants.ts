export const ADMIN_OPS_LOG_TYPES = [
  'refund',
  'prize_payout',
  'top_up',
  'mis_send',
  'incident',
  'fee_refund',
  'other',
] as const

export type AdminOpsLogType = (typeof ADMIN_OPS_LOG_TYPES)[number]

export const ADMIN_OPS_LOG_ASSETS = ['SOL', 'OWL', 'USDC', 'NFT', 'other'] as const

export type AdminOpsLogAsset = (typeof ADMIN_OPS_LOG_ASSETS)[number]

export const ADMIN_OPS_LOG_STATUSES = ['pending', 'done', 'lost', 'needs_decision'] as const

export type AdminOpsLogStatus = (typeof ADMIN_OPS_LOG_STATUSES)[number]
